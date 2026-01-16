@isTest
private class CasePresenceDraftHandlerTest {
    
    @TestSetup
    static void makeData() {
        // Create test case
        Case testCase = new Case(
            Subject = 'Test Case',
            Status = 'New',
            Origin = 'Web'
        );
        insert testCase;
    }
    
    @isTest
    static void testCurrentUserHasDraftEmails_WithDrafts() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        // Create draft EmailMessage
        EmailMessage draft = new EmailMessage(
            ParentId = testCase.Id,
            Subject = 'Test Draft',
            Status = '5', // 5 = Draft
            HtmlBody = 'Test body',
            ToAddress = 'test@example.com'
        );
        insert draft;
        
        Test.startTest();
        Boolean hasDrafts = CasePresenceDraftHandler.currentUserHasDraftEmails(testCase.Id);
        Boolean hasAnyDrafts = CasePresenceDraftHandler.currentUserHasAnyDrafts(testCase.Id);
        Test.stopTest();
        
        System.assertEquals(true, hasDrafts, 'Should find one draft email');
        System.assertEquals(true, hasAnyDrafts, 'Should find any drafts');
    }
    
    @isTest
    static void testCurrentUserHasDraftEmails_NoDrafts() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        Test.startTest();
        Boolean hasDrafts = CasePresenceDraftHandler.currentUserHasDraftEmails(testCase.Id);
        Test.stopTest();
        
        System.assertEquals(false, hasDrafts, 'Should find no drafts');
    }
    @isTest
    static void testCurrentUserHasDraftEmails_SentEmail() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        // Create SENT EmailMessage (Status 3 = Sent)
        EmailMessage sentEmail = new EmailMessage(
            ParentId = testCase.Id,
            Subject = 'Sent Email',
            Status = '3',
            HtmlBody = 'Sent body',
            ToAddress = 'test@example.com'
        );
        insert sentEmail;
        
        Test.startTest();
        Boolean hasDrafts = CasePresenceDraftHandler.currentUserHasDraftEmails(testCase.Id);
        Test.stopTest();
        
        System.assertEquals(false, hasDrafts, 'Should not count sent emails as drafts');
    }
}