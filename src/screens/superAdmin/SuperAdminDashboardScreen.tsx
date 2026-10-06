import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import {
  adminService,
  SuperAdminDashboard,
  SystemHealth,
  BackupStatus,
  UsageStatus,
  PrivilegedRequest,
  AutomationConfig,
  UserSession,
} from '../../services/admin/adminService';
import { SuperAdminStackParamList } from '../../navigation/SuperAdminNavigator';
import {HiraHeader, StatCard, StatusPill} from '../../components/ui/HiraUI';
import {colors, fonts, shadow} from '../../theme/hiraTheme';

const SuperAdminDashboardScreen = () => {
  const { user, accessToken, logout } = useAuth();

  const navigation =
    useNavigation<NativeStackNavigationProp<SuperAdminStackParamList>>();

  const [dashboard, setDashboard] = useState<SuperAdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [privilegedRequests, setPrivilegedRequests] = useState<
    PrivilegedRequest[]
  >([]);
  const [automations, setAutomations] = useState<AutomationConfig[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);

  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const reviewInFlightRef = useRef(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [requestErrors, setRequestErrors] = useState<
    Record<string, { message: string; lastStatus: 'approved' | 'rejected' }>
  >({});
  const [automationErrors, setAutomationErrors] = useState<
    Record<string, { message: string; lastPaused: boolean }>
  >({});
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const scrollViewRef = useRef<ScrollView>(null);
  const branchesSectionYRef = useRef(0);

  const scrollToBranches = () => {
    scrollViewRef.current?.scrollTo({
      y: Math.max(0, branchesSectionYRef.current - 10),
      animated: true,
    });
  };

  const loadDashboard = useCallback(async () => {
    if (!accessToken) {
      setError('Authentication token is missing');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');

      const [
        dashboardResponse,
        healthResponse,
        backupResponse,
        usageResponse,
        privilegedRequestsResponse,
        automationsResponse,
        sessionsResponse,
      ] = await Promise.all([
        adminService.getDashboard(accessToken),
        adminService.getSystemHealth(accessToken),
        adminService.getBackupStatus(accessToken),
        adminService.getUsageStatus(accessToken),
        adminService.getPendingPrivilegedRequests(accessToken),
        adminService.getAutomations(accessToken),
        adminService.getSessions(accessToken),
      ]);

      setDashboard(dashboardResponse.data);
      setHealth(healthResponse.data);
      setBackup(backupResponse.data);
      setUsage(usageResponse.data);
      setPrivilegedRequests(privilegedRequestsResponse.data.requests);
      setAutomations(automationsResponse.data.automations);
      setSessions(sessionsResponse.data.sessions);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load dashboard',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleReviewRequest = async (
    requestId: string,
    status: 'approved' | 'rejected',
  ) => {
    if (!accessToken || reviewInFlightRef.current) return;

    try {
      reviewInFlightRef.current = true;
      setReviewingId(requestId);
      setFeedbackMessage('');
      setRequestErrors(prev => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });

      const res = await adminService.reviewPrivilegedRequest(
        accessToken,
        requestId,
        status,
      );

      if (
        res.success &&
        res.data?._id === requestId &&
        res.data.status === status
      ) {
        setPrivilegedRequests(prev =>
          prev.filter(req => req._id !== requestId),
        );
        setFeedbackMessage(
          res.message || `Request successfully ${status}.`,
        );
      } else {
        const errMsg = res.success
          ? 'The server did not confirm the requested decision. The request remains pending.'
          : res.message || 'Failed to review request';
        setRequestErrors(prev => ({
          ...prev,
          [requestId]: { message: errMsg, lastStatus: status },
        }));
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Error reviewing request';
      setRequestErrors(prev => ({
        ...prev,
        [requestId]: { message: errMsg, lastStatus: status },
      }));
    } finally {
      reviewInFlightRef.current = false;
      setReviewingId(null);
    }
  };

  const handleToggleAutomation = async (
    key: string,
    currentPaused: boolean,
  ) => {
    if (!accessToken || togglingKey) return;

    try {
      setTogglingKey(key);
      setFeedbackMessage('');
      setAutomationErrors(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      const res = await adminService.toggleAutomationPause(
        accessToken,
        key,
        !currentPaused,
      );

      if (res.success) {
        setAutomations(prev =>
          prev.map(auto => (auto.key === key ? res.data : auto)),
        );
        setFeedbackMessage(
          `Automation "${res.data.name}" ${
            res.data.isPaused ? 'paused' : 'resumed'
          }.`,
        );
      } else {
        const errMsg = res.message || 'Failed to update automation';
        setAutomationErrors(prev => ({
          ...prev,
          [key]: { message: errMsg, lastPaused: currentPaused },
        }));
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Error updating automation';
      setAutomationErrors(prev => ({
        ...prev,
        [key]: { message: errMsg, lastPaused: currentPaused },
      }));
    } finally {
      setTogglingKey(null);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!accessToken || revokingId) return;

    try {
      setRevokingId(sessionId);
      setFeedbackMessage('');
      setSessionErrors(prev => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });

      const res = await adminService.revokeSession(accessToken, sessionId);

      if (res.success) {
        setSessions(prev =>
          prev.map(sess => (sess._id === sessionId ? res.data : sess)),
        );
        setFeedbackMessage('Session successfully revoked.');
      } else {
        const errMsg = res.message || 'Failed to revoke session';
        setSessionErrors(prev => ({
          ...prev,
          [sessionId]: errMsg,
        }));
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Error revoking session';
      setSessionErrors(prev => ({
        ...prev,
        [sessionId]: errMsg,
      }));
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0066cc" />
        <Text style={styles.statusText}>Loading dashboard...</Text>
      </View>
    );
  }

  if (error && !dashboard) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadDashboard}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!dashboard) {
    return (
      <View style={styles.center}>
        <Text>No dashboard data available.</Text>
      </View>
    );
  }

  const { branches } = dashboard;

  const filteredBranches = branches.list.filter(branch => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query === '' ||
      branch.name.toLowerCase().includes(query) ||
      branch.code.toLowerCase().includes(query);

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'active'
        ? branch.isActive
        : !branch.isActive;

    return matchesSearch && matchesStatus;
  });

  return (
    <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
      <HiraHeader onLogout={logout} />

      <View style={styles.nextStepsCard}>
        <Text style={styles.nextStepsTitle}>Your next steps</Text>
        <View style={styles.nextStepsActions}>
          <View style={styles.attentionButton}>
            <Text style={styles.attentionButtonText}>
              {privilegedRequests.length} {privilegedRequests.length === 1 ? 'item needs' : 'items need'} attention
            </Text>
          </View>
          <View style={styles.outlineAction}><Text style={styles.outlineActionText}>Branches</Text></View>
        </View>
        <View style={styles.nextStepsLowerRow}>
          <View style={styles.outlineAction}><Text style={styles.outlineActionText}>System health</Text></View>
        </View>
      </View>

      <View style={styles.greetingRow}>
        <View>
          <Text style={styles.greeting}>Hello, {user?.fullName?.split(' ')[0] ?? 'Admin'}!</Text>
          <Text style={styles.greetingCaption}>Here’s your school network at a glance.</Text>
        </View>
        <View style={styles.dateChip}><Text style={styles.dateChipText}>TODAY</Text></View>
      </View>

      {error !== '' && dashboard !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButtonBanner}
            onPress={loadDashboard}>
            <Text style={styles.retryButtonBannerText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {feedbackMessage !== '' && (
        <View style={styles.feedbackBanner}>
          <Text style={styles.feedbackText}>{feedbackMessage}</Text>
        </View>
      )}

      <ImageBackground
        style={styles.heroCard}
        imageStyle={styles.heroBackgroundImage}
        source={require('../../assets/images/school-art.webp')}>
        <View style={styles.heroImageFade} />
        <View style={styles.heroContent}>
          <View>
            <Text style={styles.heroKicker}>A BRIGHT DAY TO GROW</Text>
            <Text style={styles.heroTitle}>Your school network{`\n`}is in good hands.</Text>
        <Text style={styles.heroCopy}>Review today’s essentials and keep every branch moving forward.</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.heroPrimaryAction}
            onPress={scrollToBranches}>
            <Text style={styles.heroPrimaryActionText}>Explore branches</Text>
          </TouchableOpacity>
        </View>
      </ImageBackground>

      <Text style={styles.overviewTitle}>Your overview</Text>
      <View style={styles.statsGrid}>
        <StatCard label="All branches" value={branches.total} hint="Registered schools" tone="blue" />
        <StatCard label="Active today" value={branches.active} hint="Ready to learn" tone="lime" />
        <StatCard label="Inactive" value={branches.inactive} hint="Need attention" tone="orange" />
        <StatCard label="Requests" value={privilegedRequests.length} hint="Awaiting review" tone="purple" />
      </View>

      {/* Assigned Branches */}
      <View
        style={styles.section}
        onLayout={event => {
          branchesSectionYRef.current = event.nativeEvent.layout.y;
        }}>
        <Text style={styles.sectionTitle}>Assigned Branches</Text>

        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or code..."
          placeholderTextColor="#888888"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />

        <View style={styles.filterContainer}>
          {(['all', 'active', 'inactive'] as const).map(filter => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterButton,
                statusFilter === filter && styles.filterButtonActive,
              ]}
              onPress={() => setStatusFilter(filter)}>
              <Text
                style={[
                  styles.filterButtonText,
                  statusFilter === filter && styles.filterButtonTextActive,
                ]}>
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {filteredBranches.length === 0 ? (
          <Text style={styles.empty}>No branches found.</Text>
        ) : (
          filteredBranches.map(branch => (
            <View key={branch._id} style={styles.branchCard}>
              <Text style={styles.branchName}>{branch.name}</Text>
              <Text style={styles.branchCode}>{branch.code}</Text>
              <Text style={styles.branchInfo}>
                {branch.city} • {branch.address}
              </Text>
              <StatusPill label={branch.isActive ? 'Active' : 'Inactive'} tone={branch.isActive ? 'green' : 'orange'} />

              {hasPermission(user?.role, PERMISSIONS.BRANCHES_VIEW) && (
                <TouchableOpacity
                  style={styles.viewButton}
                  onPress={() =>
                    navigation.navigate('SuperAdminBranchDetails', {
                      branchId: branch._id,
                    })
                  }>
                  <Text style={styles.viewButtonText}>View Branch</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </View>

      {/* System Health */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>System Health</Text>

        <View style={styles.healthCard}>
          <Text style={styles.healthTitle}>API</Text>
          <Text style={styles.healthStatus}>
            {health?.api.status.toUpperCase()}
          </Text>
          <Text style={styles.healthMessage}>{health?.api.message}</Text>
        </View>

        <View style={styles.healthCard}>
          <Text style={styles.healthTitle}>Database</Text>
          <Text style={styles.healthStatus}>
            {health?.database.status.toUpperCase()}
          </Text>
          <Text style={styles.healthMessage}>{health?.database.message}</Text>
        </View>

        <View style={styles.healthCard}>
          <Text style={styles.healthTitle}>Overall</Text>
          <Text style={styles.healthStatus}>
            {health?.overall.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Backup Alerts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backup Alerts</Text>

        <View style={styles.healthCard}>
          <Text style={styles.healthTitle}>Backup Monitoring</Text>
          <Text style={styles.healthStatus}>
            {backup?.status.replace('_', ' ').toUpperCase()}
          </Text>
          <Text style={styles.healthMessage}>{backup?.message}</Text>
          <Text style={styles.healthMessage}>
            Last successful backup:{' '}
            {backup?.lastSuccessfulBackup ?? 'Not available'}
          </Text>
          <Text style={styles.healthMessage}>
            Next scheduled backup:{' '}
            {backup?.nextScheduledBackup ?? 'Not available'}
          </Text>
        </View>
      </View>

      {/* Usage Limits */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Usage Limits</Text>

        {usage ? (
          <>
            <View style={styles.healthCard}>
              <Text style={styles.healthTitle}>Branches</Text>
              <Text style={styles.value}>{usage.branches.used}</Text>
              <Text style={styles.label}>
                Limit:{' '}
                {usage.branches.limit === null
                  ? 'Not configured'
                  : usage.branches.limit}
              </Text>
              <Text style={styles.statusText}>
                Status: {usage.branches.status}
              </Text>
            </View>

            <View style={styles.healthCard}>
              <Text style={styles.healthTitle}>Users</Text>
              <Text style={styles.value}>{usage.users.used}</Text>
              <Text style={styles.label}>
                Limit:{' '}
                {usage.users.limit === null
                  ? 'Not configured'
                  : usage.users.limit}
              </Text>
              <Text style={styles.statusText}>
                Status: {usage.users.status}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.empty}>Usage data not available.</Text>
        )}
      </View>

      {/* Pending Privileged Requests */}
      {hasPermission(user?.role, PERMISSIONS.PRIVILEGED_REQUESTS_MANAGE) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Privileged Requests</Text>

          {privilegedRequests.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.empty}>No pending privileged requests</Text>
            </View>
          ) : (
            privilegedRequests.map(request => {
              const isProcessing = reviewingId === request._id;
              const reviewInProgress = reviewingId !== null;
              const reqErr = requestErrors[request._id];
              return (
                <View key={request._id} style={styles.card}>
                  <Text style={styles.cardTitle}>{request.requestType}</Text>
                  <Text style={styles.label}>
                    Requester: {request.requesterId?.fullName ?? 'Unknown'}
                  </Text>
                  <Text style={styles.label}>
                    Role: {request.requesterId?.role ?? 'Unknown'}
                  </Text>
                  {request.branchId && (
                    <Text style={styles.label}>
                      Branch: {request.branchId.name} ({request.branchId.code})
                    </Text>
                  )}
                  <Text style={styles.label}>Reason: {request.reason}</Text>
                  <Text style={styles.statusText}>Status: {request.status}</Text>

                  {reqErr && (
                    <View style={styles.actionErrorBanner}>
                      <Text style={styles.actionErrorText}>{reqErr.message}</Text>
                      <TouchableOpacity
                        style={styles.inlineRetryButton}
                        disabled={reviewInProgress}
                        onPress={() =>
                          handleReviewRequest(request._id, reqErr.lastStatus)
                        }>
                        <Text style={styles.inlineRetryText}>
                          Retry {reqErr.lastStatus === 'approved' ? 'Approve' : 'Reject'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[
                        styles.approveButton,
                        reviewInProgress && styles.buttonDisabled,
                      ]}
                      disabled={reviewInProgress}
                      onPress={() =>
                        handleReviewRequest(request._id, 'approved')
                      }>
                      {isProcessing ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Approve</Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.rejectButton,
                        reviewInProgress && styles.buttonDisabled,
                      ]}
                      disabled={reviewInProgress}
                      onPress={() =>
                        handleReviewRequest(request._id, 'rejected')
                      }>
                      {isProcessing ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Reject</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* Permitted Automations */}
      {hasPermission(user?.role, PERMISSIONS.AUTOMATIONS_MANAGE) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Automation Controls</Text>

          {automations.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.empty}>No automations configured</Text>
            </View>
          ) : (
            automations.map(auto => {
              const isProcessing = togglingKey === auto.key;
              const autoErr = automationErrors[auto.key];

              return (
                <View key={auto._id} style={styles.card}>
                  <Text style={styles.cardTitle}>{auto.name}</Text>
                  <Text style={styles.label}>{auto.description}</Text>

                  <View style={styles.badgeRow}>
                    <Text
                      style={[
                        styles.badge,
                        auto.isPaused ? styles.badgePaused : styles.badgeActive,
                      ]}>
                      {auto.isPaused ? 'PAUSED' : 'ACTIVE'}
                    </Text>
                  </View>

                  {autoErr && (
                    <View style={styles.actionErrorBanner}>
                      <Text style={styles.actionErrorText}>{autoErr.message}</Text>
                      <TouchableOpacity
                        style={styles.inlineRetryButton}
                        disabled={isProcessing}
                        onPress={() =>
                          handleToggleAutomation(auto.key, autoErr.lastPaused)
                        }>
                        <Text style={styles.inlineRetryText}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[
                      auto.isPaused ? styles.resumeButton : styles.pauseButton,
                      isProcessing && styles.buttonDisabled,
                    ]}
                    disabled={isProcessing}
                    onPress={() =>
                      handleToggleAutomation(auto.key, auto.isPaused)
                    }>
                    {isProcessing ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>
                        {auto.isPaused ? 'Resume Automation' : 'Pause Automation'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* Session Security Controls */}
      {hasPermission(user?.role, PERMISSIONS.SESSIONS_MANAGE) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session Security Controls</Text>

          {sessions.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.empty}>No active sessions</Text>
            </View>
          ) : (
            sessions.map(sess => {
              const isProcessing = revokingId === sess._id;
              const sessErr = sessionErrors[sess._id];

              return (
                <View key={sess._id} style={styles.card}>
                  <Text style={styles.cardTitle}>
                    User: {sess.userId?.fullName ?? 'Unknown'}
                  </Text>
                  <Text style={styles.label}>
                    Email: {sess.userId?.email ?? 'N/A'}
                  </Text>
                  <Text style={styles.label}>Role: {sess.role}</Text>
                  <Text style={styles.label}>
                    Session ID: {sess._id.substring(0, 10)}...
                  </Text>

                  <View style={styles.badgeRow}>
                    <Text
                      style={[
                        styles.badge,
                        sess.isRevoked ? styles.badgeRevoked : styles.badgeActive,
                      ]}>
                      {sess.isRevoked ? 'REVOKED' : 'ACTIVE'}
                    </Text>
                  </View>

                  {sessErr && (
                    <View style={styles.actionErrorBanner}>
                      <Text style={styles.actionErrorText}>{sessErr}</Text>
                      <TouchableOpacity
                        style={styles.inlineRetryButton}
                        disabled={isProcessing}
                        onPress={() => handleRevokeSession(sess._id)}>
                        <Text style={styles.inlineRetryText}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {!sess.isRevoked && (
                    <TouchableOpacity
                      style={[
                        styles.revokeButton,
                        isProcessing && styles.buttonDisabled,
                      ]}
                      disabled={isProcessing}
                      onPress={() => handleRevokeSession(sess._id)}>
                      {isProcessing ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.buttonText}>Revoke Session</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </View>
      )}
    </ScrollView>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f5f6fa',
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
  },

  feedbackBanner: {
    backgroundColor: '#e3f2fd',
    borderColor: '#90caf9',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },

  feedbackText: {
    color: '#1565c0',
    fontWeight: '600',
    fontSize: 14,
    textAlign: 'center',
  },

  card: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },

  value: {
    fontSize: 32,
    fontWeight: '700',
    marginTop: 8,
  },

  label: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },

  section: {
    marginTop: 8,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },

  branchCard: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },

  branchName: {
    fontSize: 18,
    fontWeight: '700',
  },

  branchCode: {
    fontSize: 14,
    marginTop: 4,
    fontWeight: '600',
  },

  branchInfo: {
    fontSize: 14,
    color: '#666666',
    marginTop: 8,
  },

  branchStatus: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },

  empty: {
    color: '#666666',
  },

  statusText: {
    marginTop: 10,
  },

  error: {
    color: '#d32f2f',
    textAlign: 'center',
    fontSize: 16,
  },

  healthCard: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },

  healthTitle: {
    fontSize: 16,
    fontWeight: '700',
  },

  healthStatus: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },

  healthMessage: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },

  viewButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#eeeeee',
  },

  viewButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },

  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 10,
  },

  approveButton: {
    flex: 1,
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  rejectButton: {
    flex: 1,
    backgroundColor: '#c62828',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  pauseButton: {
    marginTop: 12,
    backgroundColor: '#e65100',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  resumeButton: {
    marginTop: 12,
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  revokeButton: {
    marginTop: 12,
    backgroundColor: '#b71c1c',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },

  badgeRow: {
    marginTop: 8,
    flexDirection: 'row',
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },

  badgeActive: {
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
  },

  badgePaused: {
    backgroundColor: '#fff3e0',
    color: '#e65100',
  },

  badgeRevoked: {
    backgroundColor: '#ffebee',
    color: '#c62828',
  },

  searchInput: {
    backgroundColor: '#ffffff',
    borderColor: '#cccccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333333',
    marginBottom: 12,
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#eeeeee',
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: '#0066cc',
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
  },
  filterButtonTextActive: {
    color: '#ffffff',
  },

  retryButton: {
    marginTop: 16,
    backgroundColor: '#0066cc',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: '#ffebee',
    borderColor: '#ef5350',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorBannerText: {
    color: '#c62828',
    fontWeight: '600',
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  retryButtonBanner: {
    backgroundColor: '#c62828',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  retryButtonBannerText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 12,
  },
  actionErrorBanner: {
    backgroundColor: '#ffebee',
    borderColor: '#ef5350',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionErrorText: {
    color: '#c62828',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  inlineRetryButton: {
    backgroundColor: '#c62828',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  inlineRetryText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  ...baseStyles,
  container: {padding: 14, paddingTop: 18, paddingBottom: 46, backgroundColor: colors.cream},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, backgroundColor: colors.cream},
  statusText: {fontFamily: fonts.body, color: colors.muted, fontSize: 14, marginTop: 10},
  title: {fontFamily: fonts.display, color: colors.ink},
  nextStepsCard: {backgroundColor: colors.white, borderRadius: 22, padding: 14, marginBottom: 16, ...shadow},
  nextStepsTitle: {fontFamily: fonts.heading, color: colors.ink, fontSize: 15, marginBottom: 10},
  nextStepsActions: {flexDirection: 'row', alignItems: 'center', gap: 9},
  attentionButton: {backgroundColor: '#4b5bbb', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10},
  attentionButtonText: {fontFamily: fonts.bodySemiBold, color: colors.white, fontSize: 12},
  outlineAction: {borderWidth: 1, borderColor: '#e6dcca', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#fffdf9'},
  outlineActionText: {fontFamily: fonts.bodySemiBold, color: '#4b5bbb', fontSize: 12},
  nextStepsLowerRow: {marginTop: 9, alignItems: 'flex-start'},
  greetingRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15},
  greeting: {fontFamily: fonts.display, fontSize: 27, lineHeight: 33, letterSpacing: -1, color: colors.ink, maxWidth: 270},
  greetingCaption: {fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 4, maxWidth: 290},
  dateChip: {backgroundColor: colors.softPurple, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7, marginTop: 5},
  dateChipText: {fontFamily: fonts.bodySemiBold, fontSize: 10, letterSpacing: .6, color: '#685b88'},
  heroCard: {backgroundColor: '#ffe2a0', borderRadius: 24, minHeight: 214, padding: 18, overflow: 'hidden', marginBottom: 24, borderWidth: 1, borderColor: '#f4d58f'},
  heroBackgroundImage: {borderRadius: 23},
  heroImageFade: {position: 'absolute', left: 0, top: 0, bottom: 0, width: '66%', backgroundColor: '#ffe2a0', opacity: .9},
  heroContent: {flex: 1, justifyContent: 'space-between', alignItems: 'flex-start'},
  heroSun: {position: 'absolute', right: 42, top: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff5c9'},
  heroCloudOne: {position: 'absolute', right: 12, top: 54, width: 64, height: 20, borderRadius: 12, backgroundColor: '#fff1c0', opacity: .8},
  heroCloudTwo: {position: 'absolute', right: 72, top: 68, width: 40, height: 14, borderRadius: 9, backgroundColor: '#fff1c0', opacity: .65},
  schoolIllustration: {position: 'absolute', right: -3, bottom: 4, width: 157, height: 128, alignItems: 'center'},
  schoolRoof: {width: 108, height: 37, backgroundColor: '#f39a75', transform: [{rotate: '45deg'}], borderTopLeftRadius: 8, position: 'absolute', top: 13},
  schoolBody: {width: 121, height: 70, backgroundColor: '#fff8e5', borderRadius: 7, position: 'absolute', bottom: 25, borderWidth: 3, borderColor: '#edb266'},
  schoolDoor: {position: 'absolute', width: 22, height: 35, backgroundColor: '#7e705e', bottom: 0, left: 47, borderTopLeftRadius: 5, borderTopRightRadius: 5},
  schoolWindow: {position: 'absolute', width: 20, height: 18, backgroundColor: colors.softBlue, top: 14, left: 15, borderRadius: 3},
  schoolWindowRight: {position: 'absolute', width: 20, height: 18, backgroundColor: colors.softBlue, top: 14, right: 15, borderRadius: 3},
  schoolPath: {position: 'absolute', width: 130, height: 16, backgroundColor: '#efc77c', bottom: 10, borderRadius: 12, transform: [{rotate: '-6deg'}]},
  heroKicker: {fontFamily: fonts.bodySemiBold, fontSize: 9, letterSpacing: 1.2, color: '#9a7442'},
  heroTitle: {fontFamily: fonts.display, fontSize: 21, lineHeight: 25, letterSpacing: -.5, color: colors.ink, marginTop: 8, maxWidth: 190},
  heroCopy: {fontFamily: fonts.body, fontSize: 11, lineHeight: 16, color: '#716b5d', marginTop: 8, maxWidth: 183},
  heroPrimaryAction: {backgroundColor: '#4b5bbb', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, alignSelf: 'flex-start'},
  heroPrimaryActionText: {fontFamily: fonts.bodySemiBold, color: colors.white, fontSize: 11},
  overviewTitle: {fontFamily: fonts.heading, color: colors.ink, fontSize: 19, marginBottom: 13},
  statsGrid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 22},
  section: {marginTop: 13},
  sectionTitle: {fontFamily: fonts.heading, fontSize: 19, color: colors.ink, marginBottom: 12},
  card: {backgroundColor: colors.white, padding: 18, borderRadius: 20, marginBottom: 12, ...shadow},
  cardTitle: {fontFamily: fonts.heading, fontSize: 16, color: colors.ink},
  value: {fontFamily: fonts.display, fontSize: 30, color: colors.ink, marginTop: 7},
  label: {fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 4},
  branchCard: {backgroundColor: colors.white, padding: 18, borderRadius: 20, marginBottom: 12, ...shadow},
  branchName: {fontFamily: fonts.heading, fontSize: 17, color: colors.ink},
  branchCode: {fontFamily: fonts.bodySemiBold, fontSize: 11, letterSpacing: .5, color: colors.primary, marginTop: 5},
  branchInfo: {fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 8, marginBottom: 10},
  branchStatus: {fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.success, marginTop: 8},
  healthCard: {backgroundColor: colors.white, padding: 18, borderRadius: 20, marginBottom: 12, borderWidth: 1, borderColor: colors.line},
  healthTitle: {fontFamily: fonts.heading, fontSize: 16, color: colors.ink},
  healthStatus: {fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.primary, marginTop: 8},
  healthMessage: {fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 5},
  searchInput: {backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 12, fontFamily: fonts.body, fontSize: 13, color: colors.ink, marginBottom: 11},
  filterContainer: {flexDirection: 'row', marginBottom: 14, gap: 8},
  filterButton: {flex: 1, paddingVertical: 9, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: 'center'},
  filterButtonActive: {backgroundColor: colors.primary, borderColor: colors.primary},
  filterButtonText: {fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.muted},
  filterButtonTextActive: {color: colors.white},
  viewButton: {marginTop: 14, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', backgroundColor: colors.softBlue},
  viewButtonText: {fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.primary},
  actionRow: {flexDirection: 'row', marginTop: 14, gap: 10},
  approveButton: {flex: 1, backgroundColor: colors.primary, paddingVertical: 11, borderRadius: 14, alignItems: 'center'},
  rejectButton: {flex: 1, backgroundColor: colors.dangerSoft, paddingVertical: 11, borderRadius: 14, alignItems: 'center'},
  pauseButton: {marginTop: 14, backgroundColor: colors.softOrange, paddingVertical: 11, borderRadius: 14, alignItems: 'center'},
  resumeButton: {marginTop: 14, backgroundColor: colors.primary, paddingVertical: 11, borderRadius: 14, alignItems: 'center'},
  revokeButton: {marginTop: 14, backgroundColor: colors.dangerSoft, paddingVertical: 11, borderRadius: 14, alignItems: 'center'},
  buttonText: {fontFamily: fonts.bodySemiBold, color: colors.white, fontSize: 13},
  buttonDisabled: {opacity: .55},
  badge: {paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, fontFamily: fonts.bodySemiBold, fontSize: 11, overflow: 'hidden'},
  badgeActive: {backgroundColor: '#e1f1e7', color: colors.success},
  badgePaused: {backgroundColor: colors.softOrange, color: '#80513e'},
  badgeRevoked: {backgroundColor: colors.dangerSoft, color: colors.danger},
  feedbackBanner: {backgroundColor: colors.softBlue, borderRadius: 16, padding: 13, marginBottom: 16},
  feedbackText: {fontFamily: fonts.bodyMedium, color: colors.primary, fontSize: 13, textAlign: 'center'},
  error: {fontFamily: fonts.bodyMedium, color: colors.danger, textAlign: 'center', fontSize: 15},
  retryButton: {marginTop: 16, backgroundColor: colors.primary, paddingVertical: 11, paddingHorizontal: 22, borderRadius: 14},
  retryButtonText: {fontFamily: fonts.bodySemiBold, color: colors.white, fontSize: 13},
  errorBanner: {backgroundColor: colors.dangerSoft, borderRadius: 16, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center'},
  errorBannerText: {fontFamily: fonts.bodyMedium, color: colors.danger, fontSize: 13, flex: 1, marginRight: 8},
  retryButtonBanner: {backgroundColor: colors.white, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10},
  retryButtonBannerText: {fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: 12},
  actionErrorBanner: {backgroundColor: colors.dangerSoft, borderRadius: 14, padding: 10, marginTop: 10, flexDirection: 'row', alignItems: 'center'},
  actionErrorText: {fontFamily: fonts.body, color: colors.danger, fontSize: 12, flex: 1, marginRight: 8},
  inlineRetryButton: {backgroundColor: colors.white, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 9},
  inlineRetryText: {fontFamily: fonts.bodySemiBold, color: colors.danger, fontSize: 11},
  empty: {fontFamily: fonts.body, color: colors.muted, fontSize: 13},
});

export default SuperAdminDashboardScreen;
