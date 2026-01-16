public with sharing class CasePresencePublisher {
    
    /**
     * Publish a presence event for a user viewing/editing a case
     * @param caseId The Case ID
     * @param state The current state (active/idle/gone)
     * @param hasDraft Whether the user has an active draft
     * @param callType Type of call: 'heartbeat' or 'focus'
     */
    @AuraEnabled
    public static void publishPresence(String caseId, String state, Boolean hasDraft, String callType, Boolean isMobile) {
        try {
            // Get current user's name and photo
            User currentUser = [
                SELECT FirstName, LastName, Name, SmallPhotoUrl 
                FROM User 
                WHERE Id = :UserInfo.getUserId() 
                LIMIT 1
            ];
            String fullName = currentUser.Name;
            String photoUrl = currentUser.SmallPhotoUrl;
            
            // Get Case Number for logging
            String caseNumber = null;
            try {
                Case caseRecord = [SELECT CaseNumber FROM Case WHERE Id = :caseId LIMIT 1];
                caseNumber = caseRecord.CaseNumber;
            } catch (Exception ex) {
                System.debug('Could not fetch Case Number: ' + ex.getMessage());
            }
            
            Case_Presence__e event = new Case_Presence__e(
                CaseId__c = caseId,
                CaseNumber__c = caseNumber,
                UserId__c = UserInfo.getUserId(),
                UserName__c = fullName,
                UserPhotoUrl__c = photoUrl,
                State__c = state,
                HasDraft__c = hasDraft,
                Timestamp__c = DateTime.now(),
                CallType__c = callType,
                IsMobile__c = (isMobile != null ? isMobile : false)
            );
            
            Database.SaveResult result = EventBus.publish(event);
            
            if (!result.isSuccess()) {
                for (Database.Error error : result.getErrors()) {
                    System.debug('Error publishing presence event: ' + error.getMessage());
                }
            }
            
        } catch (Exception e) {
            throw new AuraHandledException('Error publishing presence: ' + e.getMessage());
        }
    }
    
    /**
     * Get settings from Custom Metadata
     */
    @AuraEnabled(cacheable=false)
    public static PresenceSettings getSettings() {
        List<Case_Presence_Settings__mdt> settings = [
            SELECT Heartbeat_Frequency_Seconds__c, 
                   Presence_Expiration_Minutes__c,
                   Draft_Staleness_Minutes__c,
                   Show_Join_Toasts__c,
                   Show_Edit_Start_Toasts__c,
                   Show_Edit_Stop_Toasts__c,
                   Show_Leave_Toasts__c,
                   VIP_Users__c,
                   VIP_Badge__c,
                   Key_Users__c,
                   Key_Badge__c,
                   Normal_Users__c,
                   Normal_Badge__c,
                   Enable_Debug_Logging__c,
                   Draft_Check_Interval_Seconds__c,
                   Expiration_Check_Interval_Seconds__c
            FROM Case_Presence_Settings__mdt
            WHERE DeveloperName = 'Default'
            LIMIT 1
        ];
        
        PresenceSettings result = new PresenceSettings();
        
        if (!settings.isEmpty()) {
            result.heartbeatFrequencySeconds = settings[0].Heartbeat_Frequency_Seconds__c.intValue();
            result.presenceExpirationMinutes = settings[0].Presence_Expiration_Minutes__c.intValue();
            result.draftStalenessMinutes = settings[0].Draft_Staleness_Minutes__c.intValue();
            result.showJoinToasts = settings[0].Show_Join_Toasts__c != null ? settings[0].Show_Join_Toasts__c : true;
            result.showEditStartToasts = settings[0].Show_Edit_Start_Toasts__c != null ? settings[0].Show_Edit_Start_Toasts__c : true;
            result.showEditStopToasts = settings[0].Show_Edit_Stop_Toasts__c != null ? settings[0].Show_Edit_Stop_Toasts__c : true;
            result.showLeaveToasts = settings[0].Show_Leave_Toasts__c != null ? settings[0].Show_Leave_Toasts__c : true;
            result.vipUsers = settings[0].VIP_Users__c != null ? settings[0].VIP_Users__c : 'Andy,Zakiyya,Sakshi';
            result.vipBadge = settings[0].VIP_Badge__c != null ? settings[0].VIP_Badge__c : '👑';
            result.keyUsers = settings[0].Key_Users__c != null ? settings[0].Key_Users__c : '';
            result.keyBadge = settings[0].Key_Badge__c != null ? settings[0].Key_Badge__c : '⭐';
            result.normalUsers = settings[0].Normal_Users__c != null ? settings[0].Normal_Users__c : '';
            result.normalBadge = settings[0].Normal_Badge__c != null ? settings[0].Normal_Badge__c : '👤';
            result.enableDebugLogging = settings[0].Enable_Debug_Logging__c != null ? settings[0].Enable_Debug_Logging__c : false;
            result.draftCheckIntervalSeconds = settings[0].Draft_Check_Interval_Seconds__c != null ? settings[0].Draft_Check_Interval_Seconds__c.intValue() : 10;
            result.expirationCheckIntervalSeconds = settings[0].Expiration_Check_Interval_Seconds__c != null ? settings[0].Expiration_Check_Interval_Seconds__c.intValue() : 10;
        } else {
            // Return defaults
            result.heartbeatFrequencySeconds = 240;
            result.presenceExpirationMinutes = 10; // 10 minutes - allows dormant tabs to expire
            result.draftStalenessMinutes = 5;
            result.showJoinToasts = true;
            result.showEditStartToasts = true;
            result.showEditStopToasts = true;
            result.showLeaveToasts = true;
            result.vipUsers = '';
            result.vipBadge = '👑';
            result.keyUsers = '';
            result.keyBadge = '⭐';
            result.normalUsers = '';
            result.normalBadge = '👤';
            result.enableDebugLogging = false;
            result.draftCheckIntervalSeconds = 10;
            result.expirationCheckIntervalSeconds = 10;
        }
        
        return result;
    }
    
    /**
     * Get current user information for the component
     */
    @AuraEnabled(cacheable=false)
    public static UserData getCurrentUserInfo() {
        User currentUser = [
            SELECT Id, FirstName, SmallPhotoUrl, MediumPhotoUrl, FullPhotoUrl
            FROM User
            WHERE Id = :UserInfo.getUserId()
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        
        UserData info = new UserData();
        info.userId = currentUser.Id;
        info.userName = currentUser.FirstName != null ? currentUser.FirstName : 'User';
        
        // Try multiple photo URL fields in order of preference
        if (currentUser.SmallPhotoUrl != null) {
            info.userPhotoUrl = currentUser.SmallPhotoUrl;
        } else if (currentUser.MediumPhotoUrl != null) {
            info.userPhotoUrl = currentUser.MediumPhotoUrl;
        } else if (currentUser.FullPhotoUrl != null) {
            info.userPhotoUrl = currentUser.FullPhotoUrl;
        } else {
            info.userPhotoUrl = null;
        }
        
        return info;
    }
    
    /**
     * Wrapper class for settings
     */
    public class PresenceSettings {
        @AuraEnabled public Integer heartbeatFrequencySeconds { get; set; }
        @AuraEnabled public Integer presenceExpirationMinutes { get; set; }
        @AuraEnabled public Integer draftStalenessMinutes { get; set; }
        @AuraEnabled public Boolean showJoinToasts { get; set; }
        @AuraEnabled public Boolean showEditStartToasts { get; set; }
        @AuraEnabled public Boolean showEditStopToasts { get; set; }
        @AuraEnabled public Boolean showLeaveToasts { get; set; }
        @AuraEnabled public String vipUsers { get; set; }
        @AuraEnabled public String vipBadge { get; set; }
        @AuraEnabled public String keyUsers { get; set; }
        @AuraEnabled public String keyBadge { get; set; }
        @AuraEnabled public String normalUsers { get; set; }
        @AuraEnabled public String normalBadge { get; set; }
        @AuraEnabled public Boolean enableDebugLogging { get; set; }
        @AuraEnabled public Integer draftCheckIntervalSeconds { get; set; }
        @AuraEnabled public Integer expirationCheckIntervalSeconds { get; set; }
    }
    
    /**
     * Wrapper class for user info
     */
    public class UserData {
        @AuraEnabled public String userId { get; set; }
        @AuraEnabled public String userName { get; set; }
        @AuraEnabled public String userPhotoUrl { get; set; }
    }
}