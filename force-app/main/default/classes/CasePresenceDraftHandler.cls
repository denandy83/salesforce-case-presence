public with sharing class CasePresenceDraftHandler {
    
    /**
     * Check if current user has any Chatter drafts
     * Uses ConnectApi to check user's draft feed
     * @return True if user has draft(s), false otherwise
     */
    @AuraEnabled(cacheable=false)
    public static Boolean currentUserHasDrafts() {
        try {
            // Use ConnectApi to get current user's draft feed
            ConnectApi.FeedElementPage draftFeed = ConnectApi.ChatterFeeds.getFeedElementsFromFeed(
                null, // Use current user's context
                ConnectApi.FeedType.Draft,
                'me' // Current user's drafts
            );
            
            // Return true if user has any drafts
            return draftFeed != null && 
                   draftFeed.elements != null && 
                   !draftFeed.elements.isEmpty();
                   
        } catch (Exception e) {
            // If error (e.g., Chatter not enabled), assume no drafts
            System.debug('Error checking drafts: ' + e.getMessage());
            return false;
        }
    }
    
    /**
     * Check if current user has draft emails for a specific case
     * @param caseId The Case ID to check
     * @return True if user has draft email(s) for this case
     */
    @AuraEnabled(cacheable=false)
    public static Boolean currentUserHasDraftEmails(String caseId) {
        try {
            // Query for draft emails by current user on this case
            // Status = '5' is Draft status
            Integer draftCount = [
                SELECT COUNT()
                FROM EmailMessage
                WHERE RelatedToId = :caseId
                AND Status = '5'
                AND CreatedById = :UserInfo.getUserId()
                AND CreatedDate >= :DateTime.now().addMinutes(-10)
                WITH SECURITY_ENFORCED
            ];
            
            return draftCount > 0;
            
        } catch (Exception e) {
            System.debug('Error checking email drafts: ' + e.getMessage());
            return false;
        }
    }
    
    /**
     * Check if current user has ANY drafts (Chatter or Email) for this case
     * @param caseId The Case ID to check
     * @return True if user has any drafts
     */
    @AuraEnabled(cacheable=false)
    public static Boolean currentUserHasAnyDrafts(String caseId) {
        // Only check email drafts
        // Chatter drafts via ConnectApi are unreliable (cleared too quickly, not case-specific)
        return currentUserHasDraftEmails(caseId);
    }
}