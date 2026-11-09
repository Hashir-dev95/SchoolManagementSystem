import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  parentService,
  type VerifiedChild,
} from '../../services/parent/parentService';
import {
  earlyExitService,
  earlyExitOperationId,
  type EarlyExitTransport,
} from '../../services/parent/earlyExitService';
import {
  EarlyExitSession,
  useEarlyExitLifetime,
  earlyExitDenied,
  earlyExitError,
} from '../../hooks/useEarlyExitSession';
import {
  Button,
  DashboardShell,
  DashboardStateCard,
  ScreenHeading,
  WorkspaceTabs,
} from '../../components/hiraDashboard';
import {
  EarlyExitSafety,
  styles,
} from '../../components/earlyExit/EarlyExitPresentation';
import ParentEarlyExitRequests from '../../components/earlyExit/ParentEarlyExitRequests';

type Dependencies = {
  transport?: EarlyExitTransport;
  childrenTransport?: Pick<typeof parentService, 'children'>;
  operationId?: () => string;
};
const label = (child: VerifiedChild) =>
  `${child.fullName} · ${child.enrollment.schoolClass.name} ${child.enrollment.section.name} · ${child.enrollment.branch.name}`;
export default function ParentEarlyExitRequestsScreen({
  transport = earlyExitService,
  childrenTransport = parentService,
  operationId = earlyExitOperationId,
}: Dependencies) {
  return (
    <EarlyExitSession role="parent">
      {(token, branch) => (
        <Workspace
          token={token}
          branch={branch}
          transport={transport}
          childrenTransport={childrenTransport}
          operationId={operationId}
        />
      )}
    </EarlyExitSession>
  );
}
function Workspace({
  token,
  branch,
  transport,
  childrenTransport,
  operationId,
}: Required<Dependencies> & { token: string; branch: string }) {
  const { logout } = useAuth();
  const live = useEarlyExitLifetime(),
    generation = useRef(0),
    preferred = useRef(''),
    locked = useRef(false);
  const [children, setChildren] = useState<VerifiedChild[]>([]),
    [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [operationLocked, setOperationLocked] = useState(false);
  const onLock = useCallback((value: boolean) => {
    locked.current = value;
    setOperationLocked(value);
  }, []);
  const conceal = useCallback(
    (failure: unknown) => {
      if (!live.current) return;
      ++generation.current;
      setChildren([]);
      setSelected('');
      setLoading(false);
      setError(earlyExitError(failure));
      onLock(false);
      if (failure instanceof ApiError && failure.status === 401)
        logout().catch(() => undefined);
    },
    [live, logout, onLock],
  );
  const refresh = useCallback(async () => {
    if (locked.current) return;
    const request = ++generation.current;
    setChildren([]);
    setSelected('');
    setLoading(true);
    setError(null);
    try {
      const data = await childrenTransport.children(token);
      if (!live.current || request !== generation.current) return;
      if (data.items.some(item => item.enrollment.branch.id !== branch))
        throw new ApiError(404, 'Children unavailable');
      setChildren(data.items);
      setSelected(
        data.items.find(item => item.studentId === preferred.current)
          ?.studentId ??
          data.items[0]?.studentId ??
          '',
      );
    } catch (failure) {
      if (!live.current || request !== generation.current) return;
      if (earlyExitDenied(failure)) conceal(failure);
      else
        setError(
          'Verified children could not be loaded. Retry when connected.',
        );
    } finally {
      if (live.current && request === generation.current) setLoading(false);
    }
  }, [branch, childrenTransport, conceal, live, token]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const child = children.find(item => item.studentId === selected);
  return (
    <KeyboardAvoidingView
      style={styles.shell}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <DashboardShell keyboardShouldPersistTaps="handled">
        <ScreenHeading
          title="Early Exit Requests"
          subtitle="Private requests for your school-verified children"
        />
        <EarlyExitSafety />
        <Button
          title="Refresh verified children"
          variant="secondary"
          disabled={operationLocked}
          onPress={refresh}
        />
        <DashboardStateCard loading={loading} error={error} onRetry={refresh} />
        {!loading && !error && !children.length ? (
          <Text style={styles.body}>
            No verified children available. Contact your school.
          </Text>
        ) : null}
        {child ? (
          <>
            <WorkspaceTabs
              items={children.map(label)}
              selected={label(child)}
              accessibilityLabel="Verified children"
              onSelect={value => {
                if (locked.current) return;
                const next = children.find(item => label(item) === value);
                if (next) {
                  preferred.current = next.studentId;
                  setSelected(next.studentId);
                }
              }}
            />
            <ParentEarlyExitRequests
              key={JSON.stringify([
                child.studentId,
                child.enrollment.enrollmentId,
                child.enrollment.branch.id,
              ])}
              token={token}
              child={child}
              transport={transport}
              operationId={operationId}
              onDenied={conceal}
              onLock={onLock}
            />
          </>
        ) : null}
      </DashboardShell>
    </KeyboardAvoidingView>
  );
}
