public with sharing class CasePresencePublisher {
    
    /**
     * Publish a presence event for a user viewing/editing a case
     * @param caseId The Case ID
     * @param sessionId The unique session identifier
     * @param state The current state (viewing/editing/drafting)
     * @param isActive Whether the tab is currently active
     */
    @AuraEnabled
    public static void publishPresence(String caseId, String sessionId, String state, Boolean isActive) {
        try {
            Case_Presence__e event = new Case_Presence__e(
                CaseId__c = caseId,
                UserId__c = UserInfo.getUserId(),
                SessionId__c = sessionId,
                State__c = state,
                IsActive__c = isActive,
                Timestamp__c = DateTime.now()
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
    @AuraEnabled(cacheable=true)
    public static PresenceSettings getSettings() {
        List<Case_Presence_Settings__mdt> settings = [
            SELECT Heartbeat_Frequency_Seconds__c, 
                   Presence_Expiration_Minutes__c,
                   Draft_Staleness_Minutes__c,
                   Show_Join_Toasts__c,
                   Show_Edit_Start_Toasts__c,
                   Show_Edit_Stop_Toasts__c,
                   Show_Leave_Toasts__c
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
        } else {
            // Return defaults
            result.heartbeatFrequencySeconds = 20;
            result.presenceExpirationMinutes = 10;
            result.draftStalenessMinutes = 5;
            result.showJoinToasts = true;
            result.showEditStartToasts = true;
            result.showEditStopToasts = true;
            result.showLeaveToasts = true;
        }
        
        return result;
    }
    
    /**
     * Get current user information for the component
     */
    @AuraEnabled(cacheable=false)
    public static UserInfo getCurrentUserInfo() {
        User currentUser = [
            SELECT Id, Name, SmallPhotoUrl
            FROM User
            WHERE Id = :UserInfo.getUserId()
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        
        UserInfo info = new UserInfo();
        info.userId = currentUser.Id;
        info.userName = currentUser.Name;
        info.userPhotoUrl = currentUser.SmallPhotoUrl;
        
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
    }
    
    /**
     * Wrapper class for user info
     */
    public class UserInfo {
        @AuraEnabled public String userId { get; set; }
        @AuraEnabled public String userName { get; set; }
        @AuraEnabled public String userPhotoUrl { get; set; }
    }
}
