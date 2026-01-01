public with sharing class CasePresenceDraftHandler {
    
    /**
     * Query for recent draft FeedItems on a case
     * @param caseId The Case ID to check for drafts
     * @return List of draft FeedItems with creator information
     */
    @AuraEnabled(cacheable=false)
    public static List<DraftInfo> getRecentDrafts(String caseId) {
        try {
            // Get staleness minutes from custom metadata
            Integer draftStalenessMinutes = getSettings().Draft_Staleness_Minutes__c.intValue();
            DateTime cutoffTime = DateTime.now().addMinutes(-draftStalenessMinutes);
            
            List<FeedItem> drafts = [
                SELECT Id, CreatedById, CreatedBy.Name, CreatedBy.SmallPhotoUrl, CreatedDate
                FROM FeedItem
                WHERE ParentId = :caseId
                AND Status = 'Draft'
                AND CreatedDate >= :cutoffTime
                WITH SECURITY_ENFORCED
                ORDER BY CreatedDate DESC
            ];
            
            List<DraftInfo> draftInfos = new List<DraftInfo>();
            for (FeedItem draft : drafts) {
                DraftInfo info = new DraftInfo();
                info.userId = draft.CreatedById;
                info.userName = draft.CreatedBy.Name;
                info.userPhotoUrl = draft.CreatedBy.SmallPhotoUrl;
                info.createdDate = draft.CreatedDate;
                draftInfos.add(info);
            }
            
            return draftInfos;
            
        } catch (Exception e) {
            throw new AuraHandledException('Error fetching drafts: ' + e.getMessage());
        }
    }
    
    /**
     * Get settings from Custom Metadata
     */
    private static Case_Presence_Settings__mdt getSettings() {
        List<Case_Presence_Settings__mdt> settings = [
            SELECT Heartbeat_Frequency_Seconds__c, 
                   Presence_Expiration_Minutes__c,
                   Draft_Staleness_Minutes__c
            FROM Case_Presence_Settings__mdt
            WHERE DeveloperName = 'Default'
            LIMIT 1
        ];
        
        if (settings.isEmpty()) {
            // Return defaults if no custom metadata found
            Case_Presence_Settings__mdt defaultSettings = new Case_Presence_Settings__mdt();
            defaultSettings.Heartbeat_Frequency_Seconds__c = 20;
            defaultSettings.Presence_Expiration_Minutes__c = 10;
            defaultSettings.Draft_Staleness_Minutes__c = 5;
            return defaultSettings;
        }
        
        return settings[0];
    }
    
    /**
     * Wrapper class for draft information
     */
    public class DraftInfo {
        @AuraEnabled public String userId { get; set; }
        @AuraEnabled public String userName { get; set; }
        @AuraEnabled public String userPhotoUrl { get; set; }
        @AuraEnabled public DateTime createdDate { get; set; }
    }
}
