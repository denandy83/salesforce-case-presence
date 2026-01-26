// Script to debug Case Presence Log creation
// Execute this in the Developer Console or via SFDX

try {
    // 1. Get a valid Case to test with
    Case c = [SELECT Id, CaseNumber FROM Case LIMIT 1];
    System.debug('DEBUG: Using Case for test: ' + c.CaseNumber + ' (' + c.Id + ')');

    // 2. Get Current User Info
    User u = [SELECT Id, Name FROM User WHERE Id = :UserInfo.getUserId()];
    System.debug('DEBUG: Current User: ' + u.Name);

    // 3. Attempt DIRECT creation via the Handler (bypassing Platform Event)
    // This tests if the code logic works and if the current user has permission
    System.debug('DEBUG: --- Attempting DIRECT Log Upsert via Handler ---');
    
    Case_Presence_Log__c testLog = new Case_Presence_Log__c(
        Case_Id__c = c.Id,
        User_Id__c = u.Id,
        State__c = 'Active',
        Has_Draft__c = false,
        Last_Updated__c = DateTime.now(),
        User_Name__c = u.Name,
        Case_Number__c = c.CaseNumber,
        IsMobile__c = false
    );

    List<Case_Presence_Log__c> logs = new List<Case_Presence_Log__c>();
    logs.add(testLog);

    // Call the handler directly
    CasePresenceLogHandler.upsertPresenceLogs(logs);
    
    // Verify if it was created
    List<Case_Presence_Log__c> createdLogs = [
        SELECT Id, LastModifiedDate 
        FROM Case_Presence_Log__c 
        WHERE Case_Id__c = :c.Id 
        AND User_Id__c = :u.Id 
        ORDER BY LastModifiedDate DESC 
        LIMIT 1
    ];
    
    if (!createdLogs.isEmpty()) {
        System.debug('SUCCESS: Direct upsert worked. Record ID: ' + createdLogs[0].Id);
    } else {
        System.debug('FAILURE: Direct upsert finished but no record was found.');
    }

    // 4. Attempt Event Publication
    // This tests the full flow. If this fails but step 3 worked, the issue is likely 
    // with the Automated Process user permissions or the Trigger itself.
    System.debug('DEBUG: --- Attempting Platform Event Publish ---');
    
    CasePresencePublisher.publishPresence(c.Id, 'Active', false, 'heartbeat', false);
    
    System.debug('SUCCESS: Event published. Check "Case Presence Logs" tab or query the object in a few seconds to see if a NEW update happened.');

} catch (Exception e) {
    System.debug('CRITICAL ERROR: ' + e.getMessage());
    System.debug(e.getStackTraceString());
}
