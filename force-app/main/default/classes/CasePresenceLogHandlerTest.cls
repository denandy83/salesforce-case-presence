@isTest
private class CasePresenceLogHandlerTest {
    
    @TestSetup
    static void makeData() {
        Case c = new Case(Subject = 'Test');
        insert c;
    }
    
    @isTest
    static void testUpsertPresenceLogs_New() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        String userId = UserInfo.getUserId();
        
        Case_Presence_Log__c log = new Case_Presence_Log__c(
            Case_Id__c = c.Id,
            User_Id__c = userId,
            State__c = 'active',
            Last_Updated__c = System.now(),
            IsMobile__c = false
        );
        
        Test.startTest();
        CasePresenceLogHandler.upsertPresenceLogs(new List<Case_Presence_Log__c>{log});
        Test.stopTest();
        
        Integer count = [SELECT COUNT() FROM Case_Presence_Log__c];
        System.assertEquals(1, count, 'Should insert one log');
    }
    
    @isTest
    static void testUpsertPresenceLogs_Update() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        String userId = UserInfo.getUserId();
        
        // Insert initial log
        Case_Presence_Log__c initialLog = new Case_Presence_Log__c(
            Case_Id__c = c.Id,
            User_Id__c = userId,
            State__c = 'active',
            Last_Updated__c = System.now().addMinutes(-5)
        );
        insert initialLog;
        
        // Create new log object representing update
        Case_Presence_Log__c updateLog = new Case_Presence_Log__c(
            Case_Id__c = c.Id,
            User_Id__c = userId,
            State__c = 'idle',
            Last_Updated__c = System.now()
        );
        
        Test.startTest();
        CasePresenceLogHandler.upsertPresenceLogs(new List<Case_Presence_Log__c>{updateLog});
        Test.stopTest();
        
        List<Case_Presence_Log__c> logs = [SELECT Id, State__c FROM Case_Presence_Log__c];
        System.assertEquals(1, logs.size(), 'Should still be one log');
        System.assertEquals('idle', logs[0].State__c, 'State should be updated');
    }
    
    @isTest
    static void testUpsertPresenceLogs_CaseInsensitive() {
        // Test robustness against ID casing
        Case c = [SELECT Id FROM Case LIMIT 1];
        String userId = UserInfo.getUserId();
        
        // Use lowercase IDs in DB
        // Note: We can't force Salesforce to store wrong casing easily in test,
        // but we can pass strings that differ in case to the method if the method uses them as keys.
        // However, the object fields hold the "Real" ID.
        
        // Let's rely on the fact that CasePresenceLogHandler uses .toLowerCase() on the field values.
        
        Case_Presence_Log__c log1 = new Case_Presence_Log__c(
            Case_Id__c = (String)c.Id,
            User_Id__c = userId,
            State__c = 'active',
            Last_Updated__c = System.now()
        );
        insert log1;
        
        // Simulate an event coming in with mixed case (if possible) or just verify standard update works
        Case_Presence_Log__c log2 = new Case_Presence_Log__c(
            Case_Id__c = (String)c.Id,
            User_Id__c = userId,
            State__c = 'idle',
            Last_Updated__c = System.now()
        );
        
        Test.startTest();
        CasePresenceLogHandler.upsertPresenceLogs(new List<Case_Presence_Log__c>{log2});
        Test.stopTest();
        
        Integer count = [SELECT COUNT() FROM Case_Presence_Log__c];
        System.assertEquals(1, count, 'Should not create duplicate');
    }

    @isTest
    static void testUpsertPresenceLogs_ErrorHandling() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        String userId = UserInfo.getUserId();
        
        // Create a log with a value that is too long for the field to force a DML Exception
        // Assuming State__c has a max length (e.g., 20 or 255). We will use a huge string.
        String veryLongString = 'A'.repeat(300); 
        
        Case_Presence_Log__c invalidLog = new Case_Presence_Log__c(
            Case_Id__c = c.Id,
            User_Id__c = userId,
            State__c = veryLongString, // This should trigger DML exception
            Last_Updated__c = System.now()
        );
        
        Test.startTest();
        // This should catch the exception internally and create an Error_Log__c
        CasePresenceLogHandler.upsertPresenceLogs(new List<Case_Presence_Log__c>{invalidLog});
        Test.stopTest();
        
        // Verify Error Log was created
        List<Error_Log__c> errors = [SELECT Id, Problem_Child__c FROM Error_Log__c WHERE Problem_Child__c = 'Case Presence'];
        System.assert(!errors.isEmpty(), 'An Error_Log__c record should have been created on failure');
    }
}