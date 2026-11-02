import { apiClient } from '../api/apiClient';

export type NotificationCategory =
  | 'notice'
  | 'attendance'
  | 'timetable'
  | 'assigned_work'
  | 'submission_review'
  | 'catch_up'
  | 'result_status'
  | 'communication'
  | 'system';
export type NotificationDeepLink = {
  type:
    | 'inbox_notice'
    | 'teacher_timetable'
    | 'attendance_period'
    | 'submission_review'
    | 'catch_up_item';
  targetId: string;
} | null;
export interface InboxNotification {
  notificationId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  createdAt: string;
  availableAt: string;
  readAt: string | null;
  source: { type: string; revision: number };
  deepLink: NotificationDeepLink;
}
export type InboxStatus = 'all' | 'unread' | 'read';
export type InboxQuery = { status: InboxStatus; offset: number; limit: number };
export interface InboxPage extends InboxQuery {
  items: InboxNotification[];
  total: number;
  unread: number;
  nextOffset: number | null;
}
export interface InboxTransport {
  list: (token: string, query: InboxQuery) => Promise<InboxPage>;
  get: (token: string, id: string) => Promise<InboxNotification>;
  markRead: (
    token: string,
    id: string,
    operationId: string,
  ) => Promise<InboxNotification>;
}
const request = async <T>(token: string, path: string, body?: unknown) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(
      `/notifications${path}`,
      {
        token,
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body }),
      },
    )
  ).data;
export const inboxOperationId = () =>
  `inbox_read_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}_${Math.random().toString(36).slice(2)}`;
export const inboxService: InboxTransport = {
  list: (token, query) =>
    request(
      token,
      `/me?status=${query.status}&offset=${query.offset}&limit=${query.limit}`,
    ),
  get: (token, id) => request(token, `/${encodeURIComponent(id)}`),
  markRead: (token, id, clientOperationId) =>
    request(token, `/${encodeURIComponent(id)}/read`, { clientOperationId }),
};
