public without sharing class CasePresenceQuery {
    
    /**
     * Get current presence state for a case (query database log)
     * Returns all users who have been active within the last 10 minutes
     */
    @AuraEnabled(cacheable=false)
    public static List<PresenceUser> getCasePresence(String caseId) {
        DateTime tenMinutesAgo = DateTime.now().addMinutes(-10);
        
        List<Case_Presence_Log__c> logs = [
            SELECT User_Id__c, State__c, Last_Updated__c, Has_Draft__c, IsMobile__c
            FROM Case_Presence_Log__c
            WHERE Case_Id__c = :caseId
            AND Last_Updated__c > :tenMinutesAgo
            AND (State__c != 'gone' OR IsMobile__c = TRUE)
            AND User_Id__c != :UserInfo.getUserId()
            ORDER BY User_Id__c, Last_Updated__c DESC
        ];
        
        List<PresenceUser> users = new List<PresenceUser>();
        Set<String> processedUserIds = new Set<String>();
        
        for (Case_Presence_Log__c log : logs) {
            // Only include the most recent entry per user
            if (!processedUserIds.contains(log.User_Id__c)) {
                processedUserIds.add(log.User_Id__c);
                
                PresenceUser user = new PresenceUser();
                user.userId = log.User_Id__c;
                user.state = log.State__c;
                user.lastSeen = log.Last_Updated__c;
                user.hasDraft = log.Has_Draft__c != null ? log.Has_Draft__c : false;
                user.isMobile = log.IsMobile__c;
                users.add(user);
            }
        }
        
        // Get user details
        if (!users.isEmpty()) {
            Map<Id, User> userMap = new Map<Id, User>([
                SELECT Id, Name, FirstName, LastName, SmallPhotoUrl
                FROM User
                WHERE Id IN :processedUserIds
            ]);
            
            for (PresenceUser pu : users) {
                User u = userMap.get(pu.userId);
                if (u != null) {
                    pu.userName = u.Name != null ? u.Name : 'User';
                    pu.userPhotoUrl = u.SmallPhotoUrl;
                }
            }
        }
        
        return users;
    }
    
    /**
     * Get all drafts on a case (younger than 10 minutes)
     */
    @AuraEnabled(cacheable=false)
    public static List<DraftInfo> getAllDrafts(String caseId) {
        DateTime tenMinutesAgo = DateTime.now().addMinutes(-10);
        List<DraftInfo> drafts = new List<DraftInfo>();
        
        // Note: Chatter drafts are not queryable via FeedItem
        // They exist client-side only until published
        // So we only check EmailMessage drafts
        
        // Query Email drafts
        try {
            List<EmailMessage> emailDrafts = [
                SELECT Id, CreatedById, LastModifiedDate
                FROM EmailMessage
                WHERE ParentId = :caseId
                AND Status = '5'
                AND LastModifiedDate > :tenMinutesAgo
            ];
            
            for (EmailMessage em : emailDrafts) {
                DraftInfo draft = new DraftInfo();
                draft.userId = em.CreatedById;
                draft.lastModifiedDate = em.LastModifiedDate;
                draft.draftType = 'email';
                drafts.add(draft);
            }
        } catch (Exception e) {
            System.debug('Error querying Email drafts: ' + e.getMessage());
        }
        
        return drafts;
    }
    
    /**
     * Get Case details (Number, Subject, etc)
     */
    @AuraEnabled(cacheable=false)
    public static CaseInfo getCaseInfo(String caseId) {
        try {
            Case c = [
                SELECT Id, CaseNumber, Subject
                FROM Case
                WHERE Id = :caseId
                LIMIT 1
            ];
            
            CaseInfo info = new CaseInfo();
            info.caseId = c.Id;
            info.caseNumber = c.CaseNumber;
            info.caseSubject = c.Subject;
            return info;
            
        } catch (Exception e) {
            System.debug('Error getting case info: ' + e.getMessage());
            return null;
        }
    }
    
    /**
     * Wrapper class for presence user data
     */
    public class PresenceUser {
        @AuraEnabled public String userId { get; set; }
        @AuraEnabled public String userName { get; set; }
        @AuraEnabled public String userPhotoUrl { get; set; }
        @AuraEnabled public String state { get; set; }
        @AuraEnabled public DateTime lastSeen { get; set; }
        @AuraEnabled public Boolean hasDraft { get; set; }
        @AuraEnabled public Boolean isMobile { get; set; }
    }
    
    /**
     * Wrapper class for draft information
     */
    public class DraftInfo {
        @AuraEnabled public String userId { get; set; }
        @AuraEnabled public DateTime lastModifiedDate { get; set; }
        @AuraEnabled public String draftType { get; set; }
    }
    
    /**
     * Wrapper class for case information
     */
    public class CaseInfo {
        @AuraEnabled public String caseId { get; set; }
        @AuraEnabled public String caseNumber { get; set; }
        @AuraEnabled public String caseSubject { get; set; }
    }
}