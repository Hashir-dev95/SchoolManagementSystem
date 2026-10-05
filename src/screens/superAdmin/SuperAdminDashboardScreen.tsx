import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

const SuperAdminDashboardScreen = () => {
  const { user, accessToken } = useAuth();

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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Super Admin Dashboard</Text>

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

      {/* Branch Statistics */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Total Branches</Text>
        <Text style={styles.value}>{branches.total}</Text>
        <Text style={styles.label}>All registered branches</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Active Branches</Text>
        <Text style={styles.value}>{branches.active}</Text>
        <Text style={styles.label}>Currently active</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Inactive Branches</Text>
        <Text style={styles.value}>{branches.inactive}</Text>
        <Text style={styles.label}>Currently inactive</Text>
      </View>

      {/* Assigned Branches */}
      <View style={styles.section}>
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
              <Text style={styles.branchStatus}>
                {branch.isActive ? 'Active' : 'Inactive'}
              </Text>

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

const styles = StyleSheet.create({
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

export default SuperAdminDashboardScreen;
