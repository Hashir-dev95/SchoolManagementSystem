import React,{useCallback,useEffect,useState}from'react';
import{Text,TextInput}from'react-native';
import type{NativeStackScreenProps}from'@react-navigation/native-stack';
import type{TeacherStackParamList}from'../../navigation/TeacherNavigator';
import{useAuth}from'../../context/AuthContext';
import{AdminDialog,AdminFeedback,formStyles}from'../../components/hiraDashboard/AdminForm';
import{Button,DashboardShell,ScreenHeading,SectionCard,StatusBadge}from'../../components/hiraDashboard';
import{notificationOperationId,notificationService,type DeviceSession,type NotificationCategory,type NotificationPreferences,type TeacherNotification}from'../../services/teacher/notificationService';
import{useTeacherResource}from'./useTeacherResource';
import{LoadState,styles}from'./teacherUi';
import{NotificationInbox}from'../notifications/NotificationInboxScreen';
import type{InboxTransport}from'../../services/notifications/inboxService';
const inboxTransport:InboxTransport={
 list:async(token,query)=>({...query,...await notificationService.list(token,query.offset,query)}),
 get:(token,id)=>notificationService.get(token,id),
 markRead:(token,id,operation)=>notificationService.markRead(token,id,operation),
};
const readOperationId=()=>notificationOperationId('read');

const choices:{id:NotificationCategory;label:string}[]=[{id:'notice',label:'School notices'},{id:'attendance',label:'Attendance reminders'},{id:'timetable',label:'Timetable updates'},{id:'assigned_work',label:'Assigned work'},{id:'submission_review',label:'Submission reviews'},{id:'catch_up',label:'Catch-up reviews'},{id:'result_status',label:'Result status'},{id:'communication',label:'Communications'}];
type Data={preferences:NotificationPreferences;sessions:{items:DeviceSession[];total:number;currentSessionPolicy:'sign_out_only'}};

export default function TeacherNotificationsScreen(props:NativeStackScreenProps<TeacherStackParamList,'TeacherNotifications'>){
 const{user,accessToken}=useAuth();
 if(!user||!accessToken)return <Text>Session unavailable. Sign in again.</Text>;
 return <TeacherSettings key={JSON.stringify([user.id,user.role,user.branchId,accessToken])} {...props}/>;
}
function TeacherSettings({navigation}:NativeStackScreenProps<TeacherStackParamList,'TeacherNotifications'>){
 const{accessToken}=useAuth(),load=useCallback(async()=>{if(!accessToken)throw new Error('Sign in again to load notifications.');const[preferences,sessions]=await Promise.all([notificationService.preferences(accessToken),notificationService.sessions(accessToken)]);return{preferences,sessions};},[accessToken]),resource=useTeacherResource(load),[prefs,setPrefs]=useState<NotificationPreferences|null>(null),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState<{kind:'success'|'error';title:string;message:string}|null>(null),[revoke,setRevoke]=useState<DeviceSession|null>(null);
 useEffect(()=>{if(resource.data&&!prefs)setPrefs(resource.data.preferences);},[resource.data,prefs]);
 const fail=(error:unknown)=>setFeedback({kind:'error',title:'Not saved',message:error instanceof Error?error.message:'Check your connection and retry.'});
 const open=(item:TeacherNotification)=>{if(!item.deepLink)return false;if(item.deepLink.type==='chat_conversation'){if(!/^[a-fA-F0-9]{24}$/.test(item.deepLink.targetId))return false;navigation.navigate('TeacherChat',{conversationId:item.deepLink.targetId});return true;}if(item.deepLink.type==='inbox_notice'){navigation.navigate('TeacherNotice',{noticeId:item.deepLink.targetId});return true;}if(item.deepLink.type==='teacher_timetable'){navigation.navigate('TeacherTimetable');return true;}if(item.deepLink.type==='catch_up_item'){navigation.navigate('TeacherCatchUp',{catchUpId:item.deepLink.targetId});return true;}return false;};
 const save=async()=>{if(!accessToken||!prefs||busy)return;setBusy(true);setFeedback(null);try{const next=await notificationService.savePreferences(accessToken,{enabledCategories:prefs.enabledCategories,quietHours:{enabled:prefs.quietHours.enabled,start:prefs.quietHours.start,end:prefs.quietHours.end},revision:prefs.revision,clientOperationId:notificationOperationId('preferences')});setPrefs(next);setFeedback({kind:'success',title:'Preferences saved',message:'Internal notifications remain available. These settings prepare optional alerts without claiming external delivery.'});}catch(error){fail(error);}finally{setBusy(false);}};
 const confirmRevoke=async()=>{if(!accessToken||!revoke||busy)return;setBusy(true);setFeedback(null);try{await notificationService.revokeSession(accessToken,revoke.sessionId);setRevoke(null);await resource.refresh();setFeedback({kind:'success',title:'Session revoked',message:'That session can no longer access protected school data.'});}catch(error){setRevoke(null);fail(error);}finally{setBusy(false);}};
 const data=resource.data as Data|undefined;
 return <DashboardShell refreshing={resource.loading} onRefresh={resource.refresh} keyboardShouldPersistTaps="handled"><ScreenHeading title="Notifications & Preferences" subtitle="Internal alerts, quiet hours and your signed-in devices"/><LoadState loading={resource.loading} error={resource.error} retry={resource.refresh}/>{feedback?<AdminFeedback {...feedback}/>:null}
 <NotificationInbox transport={inboxTransport} openReference={open} operationId={readOperationId}/>
 {prefs?<><SectionCard title="Preferences"><Text style={styles.muted}>Preferences govern future optional alert interruption. They never delete or hide the internal record.</Text>{choices.map(choice=><Button key={choice.id} title={`${prefs.enabledCategories.includes(choice.id)?'On':'Off'} · ${choice.label}`} variant="secondary" onPress={()=>setPrefs({...prefs,enabledCategories:prefs.enabledCategories.includes(choice.id)?prefs.enabledCategories.filter(value=>value!==choice.id):[...prefs.enabledCategories,choice.id]})}/>)}</SectionCard><SectionCard title="Quiet Hours"><Button title={prefs.quietHours.enabled?'Quiet hours on':'Quiet hours off'} variant="secondary" onPress={()=>setPrefs({...prefs,quietHours:{...prefs.quietHours,enabled:!prefs.quietHours.enabled}})}/><TextInput accessibilityLabel="Quiet hours start" value={prefs.quietHours.start} onChangeText={start=>setPrefs({...prefs,quietHours:{...prefs.quietHours,start}})} placeholder="22:00" style={formStyles.input}/><TextInput accessibilityLabel="Quiet hours end" value={prefs.quietHours.end} onChangeText={end=>setPrefs({...prefs,quietHours:{...prefs.quietHours,end}})} placeholder="07:00" style={formStyles.input}/><Text style={styles.muted}>School-local time: {prefs.quietHours.timezone}. Overnight ranges are supported.</Text><Button title="Save notification preferences" disabled={busy} onPress={save}/></SectionCard></>:null}
 <SectionCard title="Device Sessions"><Text style={styles.muted}>The current session can be revoked only by signing out.</Text>{data?.sessions.items.map(session=><SectionCard key={session.sessionId} title={`${session.label}${session.current?' · Current':''}`}><Text style={styles.body}>Signed in {new Date(session.createdAt).toLocaleString()}</Text><StatusBadge status={session.revoked?'unpaid':'paid'} label={session.revoked?'Revoked':'Active'}/>{!session.current&&!session.revoked?<Button title="Revoke this session" variant="danger" onPress={()=>setRevoke(session)}/>:null}</SectionCard>)}</SectionCard>
 <SectionCard title="Sync / Retry"><Text style={styles.muted}>Changes are shown as saved only after server confirmation. No offline mutation queue or external delivery provider is active.</Text><Button title="Retry preferences and sessions" variant="secondary" onPress={resource.refresh}/></SectionCard>
 <AdminDialog visible={!!revoke} title="Revoke this session?" confirmTitle="Revoke session" danger busy={busy} onClose={()=>setRevoke(null)} onConfirm={confirmRevoke}><Text style={styles.body}>This device will lose access on its next protected request.</Text></AdminDialog></DashboardShell>;
}
