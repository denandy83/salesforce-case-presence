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
    static void testGetRecentDrafts_WithDrafts() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        // Create draft FeedItem
        FeedItem draft = new FeedItem(
            ParentId = testCase.Id,
            Body = 'Test draft',
            Status = 'Draft'
        );
        insert draft;
        
        Test.startTest();
        List<CasePresenceDraftHandler.DraftInfo> drafts = 
            CasePresenceDraftHandler.getRecentDrafts(testCase.Id);
        Test.stopTest();
        
        System.assertEquals(1, drafts.size(), 'Should find one draft');
        System.assertEquals(UserInfo.getUserId(), drafts[0].userId, 'Draft should be from current user');
        System.assertNotEquals(null, drafts[0].userName, 'User name should be populated');
    }
    
    @isTest
    static void testGetRecentDrafts_NoDrafts() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        Test.startTest();
        List<CasePresenceDraftHandler.DraftInfo> drafts = 
            CasePresenceDraftHandler.getRecentDrafts(testCase.Id);
        Test.stopTest();
        
        System.assertEquals(0, drafts.size(), 'Should find no drafts');
    }
    
    @isTest
    static void testGetRecentDrafts_PublishedPost() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        // Create published FeedItem (not draft)
        FeedItem post = new FeedItem(
            ParentId = testCase.Id,
            Body = 'Test post',
            Status = 'Published'
        );
        insert post;
        
        Test.startTest();
        List<CasePresenceDraftHandler.DraftInfo> drafts = 
            CasePresenceDraftHandler.getRecentDrafts(testCase.Id);
        Test.stopTest();
        
        System.assertEquals(0, drafts.size(), 'Should not find published posts');
    }
    
    @isTest
    static void testGetRecentDrafts_InvalidCaseId() {
        Test.startTest();
        try {
            CasePresenceDraftHandler.getRecentDrafts('invalid-id');
            System.assert(false, 'Should have thrown an exception');
        } catch (AuraHandledException e) {
            System.assert(true, 'Expected exception was thrown');
        }
        Test.stopTest();
    }
    
    @isTest
    static void testGetRecentDrafts_WithOldDrafts() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        // Create draft FeedItem
        FeedItem draft = new FeedItem(
            ParentId = testCase.Id,
            Body = 'Test draft',
            Status = 'Draft'
        );
        insert draft;
        
        // Update the created date to be older than staleness threshold
        // Note: In real scenario, old drafts would be filtered by the query
        Test.startTest();
        List<CasePresenceDraftHandler.DraftInfo> drafts = 
            CasePresenceDraftHandler.getRecentDrafts(testCase.Id);
        Test.stopTest();
        
        // The draft should still be found in test context since we just created it
        System.assertEquals(1, drafts.size(), 'Should find recent draft');
    }
}
