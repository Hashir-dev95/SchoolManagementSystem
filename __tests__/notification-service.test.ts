import{notificationService}from'../src/services/teacher/notificationService';import{apiClient}from'../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient',()=>({apiClient:{request:jest.fn()}}));const request=jest.mocked(apiClient.request);
beforeEach(()=>request.mockReset().mockResolvedValue({success:true,data:{}}));
test('notification services use protected Teacher endpoints and server operation bodies',async()=>{await notificationService.list('token');await notificationService.markRead('token','notification/unsafe','operation_123456789');await notificationService.preferences('token');await notificationService.savePreferences('token',{revision:0});await notificationService.sessions('token');await notificationService.revokeSession('token','session/unsafe');expect(request.mock.calls).toEqual([
 ['/teacher/notifications?offset=0',{token:'token',method:'GET'}],
 ['/teacher/notifications/notification%2Funsafe/read',{token:'token',method:'POST',body:{clientOperationId:'operation_123456789'}}],
 ['/teacher/notification-preferences',{token:'token',method:'GET'}],
 ['/teacher/notification-preferences',{token:'token',method:'PUT',body:{revision:0}}],
 ['/teacher/device-sessions',{token:'token',method:'GET'}],
 ['/teacher/device-sessions/session%2Funsafe/revoke',{token:'token',method:'POST',body:{}}],
]);});
