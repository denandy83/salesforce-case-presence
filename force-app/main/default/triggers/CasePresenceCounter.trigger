trigger CasePresenceCounter on Case_Presence__e (after insert) {
    // Count different call types
    Integer heartbeatCount = 0;
    Integer draftCheckCount = 0;
    
    // Collect presence logs to upsert
    Map<String, Case_Presence_Log__c> logsToUpsert = new Map<String, Case_Presence_Log__c>();
    
    for (Case_Presence__e event : Trigger.new) {
        // Count for statistics
        if (event.CallType__c == 'heartbeat') {
            heartbeatCount++;
        } else if (event.CallType__c == 'draftCheck') {
            draftCheckCount++;
        }
        
        // Create/update presence log
        String logKey = event.CaseId__c + '_' + event.UserId__c;
        Case_Presence_Log__c log = new Case_Presence_Log__c(
            Case_Id__c = event.CaseId__c,
            User_Id__c = event.UserId__c,
            State__c = event.State__c,
            Has_Draft__c = event.HasDraft__c,
            Last_Updated__c = event.Timestamp__c != null ? event.Timestamp__c : System.now(),
            User_Name__c = event.UserName__c,
            Case_Number__c = event.CaseNumber__c
        );
        logsToUpsert.put(logKey, log);
    }
    
    // Upsert presence logs
    if (!logsToUpsert.isEmpty()) {
        CasePresenceLogHandler.upsertPresenceLogs(logsToUpsert.values());
    }
    
    // Update counters if we have counts
    if (heartbeatCount > 0 || draftCheckCount > 0) {
        CasePresenceCounterHelper.incrementCountersAsync(heartbeatCount, draftCheckCount);
    }
}
