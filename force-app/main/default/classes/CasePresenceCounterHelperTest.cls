@isTest
private class CasePresenceCounterHelperTest {
    
    @isTest
    static void testIncrementCounters() {
        Test.startTest();
        // Test first increment (creates record)
        CasePresenceCounterHelper.incrementCounters(5, 2);
        Test.stopTest();
        
        CasePresenceCounterHelper.CounterStats stats = CasePresenceCounterHelper.getCounterStats();
        System.assertEquals(5, stats.heartbeatCount, 'Heartbeat count should be 5');
        System.assertEquals(2, stats.draftCheckCount, 'Draft count should be 2');
    }
    
    @isTest
    static void testIncrementCountersAsync() {
        Test.startTest();
        CasePresenceCounterHelper.incrementCountersAsync(1, 1);
        Test.stopTest();
        
        CasePresenceCounterHelper.CounterStats stats = CasePresenceCounterHelper.getCounterStats();
        System.assertEquals(1, stats.heartbeatCount);
    }
    
    @isTest
    static void testResetCounters() {
        // Setup initial data
        CasePresenceCounterHelper.incrementCounters(10, 10);
        
        Test.startTest();
        CasePresenceCounterHelper.resetCounters();
        Test.stopTest();
        
        CasePresenceCounterHelper.CounterStats stats = CasePresenceCounterHelper.getCounterStats();
        System.assertEquals(0, stats.heartbeatCount);
        System.assertEquals(0, stats.draftCheckCount);
    }
    
    @isTest
    static void testGetCounterStats_Empty() {
        // No data exists yet
        Test.startTest();
        CasePresenceCounterHelper.CounterStats stats = CasePresenceCounterHelper.getCounterStats();
        Test.stopTest();
        
        System.assertEquals(0, stats.heartbeatCount);
    }
}