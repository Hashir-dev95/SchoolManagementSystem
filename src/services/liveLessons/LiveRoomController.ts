/* eslint-disable no-void -- UI/SDK event callbacks detach operations with local error handling. */
import {
  liveLessonService,
  liveLessonError,
  type AuthorizedRoom,
  type LiveLesson,
} from './liveLessonService';
import { RtcFailure, type LiveLessonClient } from './rtc/types';
type Api = typeof liveLessonService;
export type LessonTarget =
  | { kind: 'teacher'; periodId: string; date: string }
  | { kind: 'student'; sessionId: string };
export interface LiveRoomState {
  pending: boolean;
  session: LiveLesson | null;
  error: string | null;
  notice: string | null;
  closed: boolean;
}
// Owns authorization/renewal, not media or academic authority. Credentials stay
// in call frames, and never enter navigation, React state or persistent storage.
export class LiveRoomController {
  private state: LiveRoomState = {
    pending: false,
    session: null,
    error: null,
    notice: null,
    closed: false,
  };
  private listeners = new Set<(state: LiveRoomState) => void>();
  private closed = false;
  private renewing = false;
  private renewAfter = 0;
  private finalCredential = false;
  private renewalTimer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly target: LessonTarget,
    private token: string,
    readonly rtc: LiveLessonClient,
    private api: Api = liveLessonService,
  ) {
    rtc.onTokenExpiring(() => {
      void this.renew();
    });
  }
  subscribe(listener: (state: LiveRoomState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(patch: Partial<LiveRoomState>) {
    if (this.closed && !patch.closed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener(this.state));
  }
  private authorized(): Promise<AuthorizedRoom> {
    return this.target.kind === 'teacher'
      ? this.api.startLesson(this.token, this.target.periodId, this.target.date)
      : this.api.getJoinToken(this.token, this.target.sessionId);
  }
  private schedule(expiresAt: string) {
    clearTimeout(this.renewalTimer);
    // Renew even a configured 30-second token, but never spin on a credential
    // capped to lesson end. Timing metadata contains no bearer credential.
    const remaining = Date.parse(expiresAt) - Date.now();
    if (remaining <= 0 || !Number.isFinite(remaining))
      throw new Error('Expired live credential.');
    this.finalCredential =
      Date.parse(expiresAt) >=
      Date.parse(this.state.session!.scheduledEnd) - 1000;
    const lead = Math.min(60000, Math.max(1000, remaining / 5));
    this.renewAfter = Date.now() + remaining - lead;
    this.renewalTimer = setTimeout(
      () => {
        if (!this.finalCredential) void this.renew();
        else void this.close('The live access window has ended.');
      },
      this.finalCredential ? remaining : remaining - lead,
    );
  }
  async enter() {
    if (this.closed || this.state.pending || this.state.session) return;
    this.update({ pending: true, error: null });
    let granted = false;
    try {
      const response = await this.authorized();
      granted = true;
      if (this.closed) return;
      const expected = this.target.kind === 'teacher' ? 'host' : 'participant';
      if (
        response.connection.role !== expected ||
        response.session.status !== 'live'
      )
        throw new Error('Invalid live access.');
      this.update({ session: response.session });
      await this.rtc.prepare(response.connection.appId);
      if (this.closed) return;
      await this.rtc.connect(response.connection);
      if (!this.closed) this.schedule(response.connection.expiresAt);
    } catch (error) {
      this.update({
        error: granted
          ? error instanceof RtcFailure && error.kind === 'expired'
            ? 'Your live credential expired before connection. Leave and request access again.'
            : 'School access was granted, but media connection failed. Leave this screen and try again.'
          : liveLessonError(error),
        notice:
          granted && this.target.kind === 'teacher'
            ? 'The school session may already be live. You can end it here or leave and retry the same lesson.'
            : null,
      });
      if (granted) await this.rtc.dispose();
    } finally {
      this.update({ pending: false });
    }
  }
  private async renew() {
    if (
      this.closed ||
      this.renewing ||
      !this.state.session ||
      !this.renewalTimer
    )
      return;
    // Ignore early/repeated SDK warnings for fresh short-TTL credentials. The
    // single timer still guarantees renewal before expiry.
    if (this.finalCredential || Date.now() < this.renewAfter) return;
    this.renewing = true;
    try {
      const response = await this.authorized();
      if (this.closed) return;
      if (
        response.session.id !== this.state.session.id ||
        response.session.status !== 'live'
      )
        throw new Error('Live session changed.');
      await this.rtc.renew(response.connection);
      if (!this.closed) this.schedule(response.connection.expiresAt);
    } catch {
      await this.close(
        'Live access could not be renewed. Leave and request access again through the school app.',
      );
    } finally {
      this.renewing = false;
    }
  }
  async end(): Promise<boolean> {
    if (
      this.closed ||
      this.state.pending ||
      this.target.kind !== 'teacher' ||
      !this.state.session
    )
      return false;
    this.update({ pending: true, error: null });
    try {
      const ended = await this.api.endLesson(this.token, this.state.session.id);
      this.update({ session: ended });
      await this.close('Lesson ended.');
      return true;
    } catch (error) {
      this.update({ error: liveLessonError(error) });
      return false;
    } finally {
      this.update({ pending: false });
    }
  }
  async close(notice?: string) {
    if (this.closed) return this.rtc.dispose();
    this.closed = true;
    this.token = '';
    clearTimeout(this.renewalTimer);
    this.update({
      closed: true,
      pending: false,
      ...(notice ? { notice } : {}),
    });
    await this.rtc.dispose();
  }
}
