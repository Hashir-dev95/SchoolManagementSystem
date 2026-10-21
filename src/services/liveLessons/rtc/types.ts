import type { LiveCredential } from '../liveLessonService';
export class RtcFailure extends Error {
  constructor(
    readonly kind: 'expired' | 'login' | 'initialization',
    message: string,
  ) {
    super(message);
    this.name = 'RtcFailure';
  }
}
export type ConnectionState =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'error';
export interface LiveParticipant {
  participantKey: string;
  streamId: string;
  displayName: string;
  isLocal: boolean;
  audioActive: boolean;
  videoActive: boolean;
  mediaState: 'loading' | 'playing' | 'error';
}
export interface RtcState {
  connection: ConnectionState;
  microphoneMuted: boolean;
  cameraEnabled: boolean;
  publishing: boolean;
  participants: LiveParticipant[];
  error: string | null;
}
export const initialRtcState: RtcState = {
  connection: 'idle',
  microphoneMuted: true,
  cameraEnabled: false,
  publishing: false,
  participants: [],
  error: null,
};
export interface LiveLessonClient {
  subscribe(listener: (state: RtcState) => void): () => void;
  prepare(appId: number): Promise<void>;
  preview(view: number): Promise<void>;
  connect(credential: LiveCredential): Promise<void>;
  attachRemote(streamId: string, view: number): Promise<void>;
  muteMicrophone(muted: boolean): Promise<void>;
  enableCamera(enabled: boolean): Promise<void>;
  renew(credential: LiveCredential): Promise<void>;
  onTokenExpiring(handler: () => void): void;
  dispose(): Promise<void>;
}
