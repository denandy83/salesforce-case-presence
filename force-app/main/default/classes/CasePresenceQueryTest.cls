@isTest
private class CasePresenceQueryTest {
    
    @TestSetup
    static void makeData() {
        Case testCase = new Case(
            Subject = 'Test Case',
            Status = 'New'
        );
        insert testCase;
    }
    
    @isTest
    static void testGetCasePresence() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        
        // Create logs for other users (simulated)
        // Note: In real life we can't easily create logs for "other" users due to User_Id__c constraint?
        // Actually we can insert any User_Id__c in the log object.
        
        // 1. Active User
        Case_Presence_Log__c activeLog = new Case_Presence_Log__c(
            Case_Id__c = c.Id,
            User_Id__c = '005000000000001', // Fake ID 1
            State__c = 'active',
            Last_Updated__c = System.now(),
            IsMobile__c = false,
            User_Name__c = 'Active User'
        );
        
        // 2. Mobile Gone User (Should be visible due to Grace Period logic in Query)
        Case_Presence_Log__c mobileGoneLog = new Case_Presence_Log__c(
            Case_Id__c = c.Id,
            User_Id__c = '005000000000002', // Fake ID 2
            State__c = 'gone',
            Last_Updated__c = System.now().addSeconds(-30), // Recent
            IsMobile__c = true,
            User_Name__c = 'Mobile Gone User'
        );
        
        // 3. Desktop Gone User (Should NOT be visible)
        Case_Presence_Log__c desktopGoneLog = new Case_Presence_Log__c(
            Case_Id__c = c.Id,
            User_Id__c = '005000000000003', // Fake ID 3
            State__c = 'gone',
            Last_Updated__c = System.now(),
            IsMobile__c = false,
            User_Name__c = 'Desktop Gone User'
        );
        
        insert new List<Case_Presence_Log__c>{activeLog, mobileGoneLog, desktopGoneLog};
        
        Test.startTest();
        List<CasePresenceQuery.PresenceUser> results = CasePresenceQuery.getCasePresence(c.Id);
        Test.stopTest();
        
        // We expect Active User AND Mobile Gone User
        // Desktop Gone User should be filtered out by query
        // Current User (me) is filtered out by query
        
        Boolean foundActive = false;
        Boolean foundMobileGone = false;
        Boolean foundDesktopGone = false;
        
        for(CasePresenceQuery.PresenceUser u : results) {
            if (u.userId == '005000000000001') foundActive = true;
            if (u.userId == '005000000000002') foundMobileGone = true;
            if (u.userId == '005000000000003') foundDesktopGone = true;
        }
        
        System.assert(foundActive, 'Active user should be returned');
        System.assert(foundMobileGone, 'Mobile user in "gone" state (recent) should be returned');
        System.assert(!foundDesktopGone, 'Desktop user in "gone" state should NOT be returned');
    }
    
    @isTest
    static void testGetCaseInfo() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        
        Test.startTest();
        CasePresenceQuery.CaseInfo info = CasePresenceQuery.getCaseInfo(c.Id);
        Test.stopTest();
        
        System.assertEquals(c.Id, info.caseId);
        System.assertNotEquals(null, info.caseNumber);
    }
    
    @isTest
    static void testGetAllDrafts() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        
        // Create draft email
        EmailMessage draft = new EmailMessage(
            ParentId = c.Id,
            Status = '5',
            Subject = 'Draft'
        );
        insert draft;
        
        Test.startTest();
        List<CasePresenceQuery.DraftInfo> drafts = CasePresenceQuery.getAllDrafts(c.Id);
        Test.stopTest();
        
        System.assertEquals(1, drafts.size());
    }
}