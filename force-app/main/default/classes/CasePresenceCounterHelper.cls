public class CasePresenceCounterHelper {
    
    // Counter record name (singleton pattern)
    private static final String COUNTER_NAME = 'Global_Counter';
    
    /**
     * Increment counters asynchronously to avoid governor limits
     */
    @future
    public static void incrementCountersAsync(Integer heartbeats, Integer draftChecks) {
        incrementCounters(heartbeats, draftChecks);
    }
    
    /**
     * Increment the counters (can be called from @future or synchronously)
     */
    public static void incrementCounters(Integer heartbeats, Integer draftChecks) {
        try {
            // Get or create the counter record
            List<Case_Presence_Counter__c> counters = [
                SELECT Id, Heartbeat_Count__c, Draft_Check_Count__c
                FROM Case_Presence_Counter__c
                WHERE Name = :COUNTER_NAME
                LIMIT 1
            ];
            
            Case_Presence_Counter__c counter;
            if (counters.isEmpty()) {
                // Create new counter
                counter = new Case_Presence_Counter__c(
                    Name = COUNTER_NAME,
                    Heartbeat_Count__c = 0,
                    Draft_Check_Count__c = 0,
                    Last_Reset_Date__c = System.now()
                );
            } else {
                counter = counters[0];
            }
            
            // Increment counts
            counter.Heartbeat_Count__c = (counter.Heartbeat_Count__c != null ? counter.Heartbeat_Count__c : 0) + heartbeats;
            counter.Draft_Check_Count__c = (counter.Draft_Check_Count__c != null ? counter.Draft_Check_Count__c : 0) + draftChecks;
            
            upsert counter;
            
        } catch (Exception e) {
            // Log error but don't break presence functionality
            System.debug('Error updating counters: ' + e.getMessage());
        }
    }
    
    /**
     * Get current counter values
     */
    @AuraEnabled(cacheable=false)
    public static CounterStats getCounterStats() {
        List<Case_Presence_Counter__c> counters = [
            SELECT Heartbeat_Count__c, Draft_Check_Count__c, Total_API_Calls__c, Last_Reset_Date__c
            FROM Case_Presence_Counter__c
            WHERE Name = :COUNTER_NAME
            LIMIT 1
        ];
        
        CounterStats stats = new CounterStats();
        if (!counters.isEmpty()) {
            Case_Presence_Counter__c counter = counters[0];
            stats.heartbeatCount = counter.Heartbeat_Count__c != null ? counter.Heartbeat_Count__c.intValue() : 0;
            stats.draftCheckCount = counter.Draft_Check_Count__c != null ? counter.Draft_Check_Count__c.intValue() : 0;
            stats.totalApiCalls = counter.Total_API_Calls__c != null ? counter.Total_API_Calls__c.intValue() : 0;
            stats.lastResetDate = counter.Last_Reset_Date__c;
        }
        
        return stats;
    }
    
    /**
     * Reset counters to zero
     */
    @AuraEnabled
    public static void resetCounters() {
        List<Case_Presence_Counter__c> counters = [
            SELECT Id
            FROM Case_Presence_Counter__c
            WHERE Name = :COUNTER_NAME
            LIMIT 1
        ];
        
        if (!counters.isEmpty()) {
            Case_Presence_Counter__c counter = counters[0];
            counter.Heartbeat_Count__c = 0;
            counter.Draft_Check_Count__c = 0;
            counter.Last_Reset_Date__c = System.now();
            update counter;
        } else {
            // Create new counter
            insert new Case_Presence_Counter__c(
                Name = COUNTER_NAME,
                Heartbeat_Count__c = 0,
                Draft_Check_Count__c = 0,
                Last_Reset_Date__c = System.now()
            );
        }
    }
    
    /**
     * Wrapper class for counter statistics
     */
    public class CounterStats {
        @AuraEnabled public Integer heartbeatCount { get; set; }
        @AuraEnabled public Integer draftCheckCount { get; set; }
        @AuraEnabled public Integer totalApiCalls { get; set; }
        @AuraEnabled public DateTime lastResetDate { get; set; }
    }
}