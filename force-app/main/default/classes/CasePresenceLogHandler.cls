public without sharing class CasePresenceLogHandler {
    
    /**
     * Upsert presence logs - handles matching by Case+User only
     */
    public static void upsertPresenceLogs(List<Case_Presence_Log__c> newLogs) {
        // Query existing logs for these case/user combinations
        Set<String> caseIds = new Set<String>();
        Set<String> userIds = new Set<String>();
        
        for (Case_Presence_Log__c log : newLogs) {
            caseIds.add(log.Case_Id__c);
            userIds.add(log.User_Id__c);
        }
        
        List<Case_Presence_Log__c> existingLogs = [
            SELECT Id, Case_Id__c, User_Id__c
            FROM Case_Presence_Log__c
            WHERE Case_Id__c IN :caseIds
            AND User_Id__c IN :userIds
        ];
        
        // Create map for matching
        Map<String, Id> existingLogMap = new Map<String, Id>();
        for (Case_Presence_Log__c existing : existingLogs) {
            String key = (existing.Case_Id__c + '_' + existing.User_Id__c).toLowerCase();
            existingLogMap.put(key, existing.Id);
        }
        
        // Update or insert
        List<Case_Presence_Log__c> logsToUpsert = new List<Case_Presence_Log__c>();
        for (Case_Presence_Log__c log : newLogs) {
            String key = (log.Case_Id__c + '_' + log.User_Id__c).toLowerCase();
            if (existingLogMap.containsKey(key)) {
                log.Id = existingLogMap.get(key);
            }
            logsToUpsert.add(log);
        }
        
        try {
            upsert logsToUpsert;
        } catch (Exception e) {
            System.debug('Error upserting presence logs: ' + e.getMessage());
        }
    }
}