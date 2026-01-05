import { LightningElement, api, track } from 'lwc';
import { subscribe, unsubscribe, onError } from 'lightning/empApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import publishPresence from '@salesforce/apex/CasePresencePublisher.publishPresence';
import getSettings from '@salesforce/apex/CasePresencePublisher.getSettings';
import getCurrentUserInfo from '@salesforce/apex/CasePresencePublisher.getCurrentUserInfo';
import getCasePresence from '@salesforce/apex/CasePresenceQuery.getCasePresence';
import getAllDrafts from '@salesforce/apex/CasePresenceQuery.getAllDrafts';
import getCaseInfo from '@salesforce/apex/CasePresenceQuery.getCaseInfo';

const CHANNEL_NAME = '/event/Case_Presence__e';
const DRAFT_CHECK_INTERVAL = 10000; // 10 seconds
const EXPIRATION_CHECK_INTERVAL = 10000; // 10 seconds
const PRESENCE_EXPIRATION_MS = 600000; // 10 minutes

export default class CasePresenceIndicator extends LightningElement {
    _recordId;
    
    @api 
    get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        const oldValue = this._recordId;
        this._recordId = value;
        if (oldValue && oldValue !== value) {
            this.handleRecordIdChange(value, oldValue);
        }
    }
    
    previousRecordId = null;
    
    @track visibleUsers = [];
    @track caseNumber = '';
    @track caseSubject = '';
    
    sessionId;
    currentUserId;
    currentUserName;
    currentState = null; // Current published state (active/idle/drafting/gone)
    hasDrafts = false;
    isActive = true;
    
    settings;
    debugLogging = false;
    subscription;
    isComponentActive = false;
    
    // Intervals
    draftCheckInterval = null;
    expirationCheckInterval = null;
    timeAgoInterval = null;
    visibilityCheckInterval = null;
    presenceCleanupInterval = null;
    
    // Handlers
    visibilityChangeHandler = null;
    beforeUnloadHandler = null;

    async connectedCallback() {
        this.isComponentActive = true;
        this.sessionId = this.generateSessionId();
        
        try {
            // Load settings
            this.settings = await getSettings();
            this.debugLogging = this.settings?.enableDebugLogging || false;
            
            // Get current user info
            const userInfo = await getCurrentUserInfo();
            this.currentUserId = userInfo.userId;
            this.currentUserName = userInfo.userName;
            
            this.log('🚀 Component initialized', { 
                recordId: this.recordId,
                sessionId: this.sessionId,
                userId: this.currentUserId 
            });
            
            // Load initial presence data
            if (this.recordId) {
                await this.loadInitialPresence();
            }
            
            // Subscribe to Platform Events
            await this.subscribeToPlatformEvents();
            
            // Publish initial presence
            this.isActive = document.visibilityState === 'visible';
            await this.publishStateChange(this.isActive ? 'active' : 'idle');
            
            // Start periodic tasks
            if (this.isActive) {
                this.startDraftChecking();
            }
            this.startExpirationFilter();
            this.startTimeAgoUpdates();
            this.startVisibilityMonitoring();
            this.startPresenceCleanup();
            this.setupBeforeUnload();
            
        } catch (error) {
            console.error('Error initializing component:', error);
        }
    }

    disconnectedCallback() {
        this.log('👋 Component disconnecting');
        this.sendGoodbyeHeartbeat();
        this.cleanup();
    }

    async loadInitialPresence() {
        if (!this.isComponentActive || !this.recordId) return;
        
        try {
            this.log('📥 Loading initial presence for case:', this.recordId);
            
            // Query case info
            const caseInfo = await getCaseInfo({ caseId: this.recordId });
            if (!this.isComponentActive) return;
            
            if (caseInfo) {
                this.caseNumber = caseInfo.caseNumber;
                this.caseSubject = caseInfo.caseSubject;
                this.log('Case:', this.caseNumber, this.caseSubject);
            }
            
            // Query current presence state
            const presence = await getCasePresence({ caseId: this.recordId });
            if (!this.isComponentActive) return;
            
            this.log('Found users:', presence.length);
            
            // Query all drafts
            const drafts = await getAllDrafts({ caseId: this.recordId });
            if (!this.isComponentActive) return;
            
            this.log('Found drafts:', drafts.length);
            
            // Merge draft data into presence
            const usersWithDrafts = this.mergeDraftData(presence, drafts);
            
            // Display immediately (only if still active)
            if (this.isComponentActive) {
                this.visibleUsers = usersWithDrafts;
                
                // Check if current user has drafts
                this.hasDrafts = drafts.some(d => d.userId === this.currentUserId);
            }
            
        } catch (error) {
            if (this.isComponentActive) {
                console.error('Error loading initial presence:', error);
            }
        }
    }

    mergeDraftData(presenceUsers, drafts) {
        const FIVE_MINUTES = 5 * 60 * 1000; // 5 minutes in milliseconds
        
        return presenceUsers.map(user => {
            const userDrafts = drafts.filter(d => d.userId === user.userId);
            const draftAge = userDrafts.length > 0 ? Date.now() - new Date(userDrafts[0].createdDate).getTime() : null;
            
            // Only show as "has draft" if draft is less than 5 minutes old
            const hasDraft = userDrafts.length > 0 && draftAge < FIVE_MINUTES;
            
            return {
                ...user,
                hasDraft: hasDraft,
                draftAge: draftAge,
                draftAgeMinutes: draftAge ? Math.floor(draftAge / 60000) : null
            };
        });
    }

    async subscribeToPlatformEvents() {
        const messageCallback = (response) => {
            const payload = response.data.payload;
            this.log('📨 Platform Event Received:', {
                caseId: payload.CaseId__c,
                userId: payload.UserId__c,
                userName: payload.UserName__c,
                state: payload.State__c,
                sessionId: payload.SessionId__c
            });
            
            this.handlePresenceEvent(payload);
        };

        try {
            const response = await subscribe(CHANNEL_NAME, -1, messageCallback);
            this.subscription = response;
            this.log('✅ Subscribed to Platform Events');
        } catch (error) {
            console.error('Error subscribing to Platform Events:', error);
        }

        onError(error => {
            console.error('EMP API Error:', error);
        });
    }

    handlePresenceEvent(payload) {
        // Ignore own events (they're handled locally for instant feedback)
        if (payload.UserId__c === this.currentUserId && payload.SessionId__c === this.sessionId) {
            this.log('⏭️ Ignoring own event');
            return;
        }

        // Only process events for current case
        if (payload.CaseId__c !== this.recordId) {
            this.log('⏭️ Event for different case');
            return;
        }

        const existingUserIndex = this.visibleUsers.findIndex(
            u => u.userId === payload.UserId__c && u.sessionId === payload.SessionId__c
        );

        if (payload.State__c === 'gone') {
            // User left
            if (existingUserIndex !== -1) {
                const user = this.visibleUsers[existingUserIndex];
                // Only show toast if this tab is active
                if (this.isActive && document.visibilityState === 'visible') {
                    this.showLeaveToast(user.userName);
                }
                this.visibleUsers = this.visibleUsers.filter((_, i) => i !== existingUserIndex);
                this.log('👋 User left:', payload.UserName__c);
            }
        } else {
            // User joined or updated
            const user = {
                userId: payload.UserId__c,
                userName: payload.UserName__c,
                userPhotoUrl: payload.UserPhotoUrl__c,
                state: payload.State__c,
                sessionId: payload.SessionId__c,
                lastSeen: new Date(payload.Timestamp__c),
                isActive: payload.IsActive__c,
                hasDraft: false,
                draftAge: null
            };

            if (existingUserIndex !== -1) {
                // Update existing
                this.visibleUsers = [
                    ...this.visibleUsers.slice(0, existingUserIndex),
                    user,
                    ...this.visibleUsers.slice(existingUserIndex + 1)
                ];
                this.log('🔄 User updated:', payload.UserName__c);
            } else {
                // New user - only show toast if this tab is active
                this.visibleUsers = [...this.visibleUsers, user];
                if (this.isActive && document.visibilityState === 'visible') {
                    this.showJoinToast(user.userName);
                }
                this.log('👋 User joined:', payload.UserName__c);
            }
        }
    }

    async startDraftChecking() {
        if (this.draftCheckInterval) {
            clearInterval(this.draftCheckInterval);
        }

        // Check immediately
        await this.checkDrafts();

        // Check every 10 seconds
        this.draftCheckInterval = setInterval(async () => {
            if (this.isActive && !this.isDormant && this.recordId) {
                await this.checkDrafts();
            }
        }, DRAFT_CHECK_INTERVAL);

        this.log('✅ Draft checking started');
    }

    stopDraftChecking() {
        if (this.draftCheckInterval) {
            clearInterval(this.draftCheckInterval);
            this.draftCheckInterval = null;
            this.log('⏹️ Draft checking stopped');
        }
    }

    async checkDrafts() {
        if (!this.isComponentActive || !this.recordId) return;
        
        try {
            const drafts = await getAllDrafts({ caseId: this.recordId });
            
            // Check if component is still active after async operation
            if (!this.isComponentActive) return;
            
            // Update MY draft status
            const myDrafts = drafts.filter(d => d.userId === this.currentUserId);
            const nowHasDrafts = myDrafts.length > 0;
            
            if (nowHasDrafts !== this.hasDrafts) {
                this.hasDrafts = nowHasDrafts;
                const newState = nowHasDrafts ? 'drafting' : (this.isActive ? 'active' : 'idle');
                await this.publishStateChange(newState);
                this.log(`✏️ Draft status changed: ${newState}`);
            }
            
            // Update everyone's draft indicators
            if (this.isComponentActive) {
                this.visibleUsers = this.mergeDraftData(this.visibleUsers, drafts);
            }
            
        } catch (error) {
            if (this.isComponentActive) {
                console.error('Error checking drafts:', error);
            }
        }
    }

    async publishStateChange(newState) {
        if (!this.isComponentActive || !this.recordId) return;
        
        // Don't republish same state
        if (newState === this.currentState) {
            this.log('⏭️ State unchanged, skipping publish');
            return;
        }

        this.currentState = newState;
        
        try {
            await publishPresence({
                caseId: this.recordId,
                sessionId: this.sessionId,
                state: newState,
                isActive: this.isActive,
                callType: newState.includes('draft') ? 'draftCheck' : 'heartbeat'
            });
            
            if (!this.isComponentActive) return;
            
            this.log(`📤 Published state change: ${newState}`, { isActive: this.isActive });
            
            // Update own presence in list immediately
            this.updateOwnPresence(newState);
            
        } catch (error) {
            if (this.isComponentActive) {
                console.error('Error publishing state change:', error);
            }
        }
    }

    updateOwnPresence(state) {
        const existingIndex = this.visibleUsers.findIndex(
            u => u.userId === this.currentUserId && u.sessionId === this.sessionId
        );

        const ownUser = {
            userId: this.currentUserId,
            userName: this.currentUserName + ' (you)',
            userPhotoUrl: null,
            state: state,
            sessionId: this.sessionId,
            lastSeen: new Date(),
            isActive: this.isActive,
            hasDraft: this.hasDrafts
        };

        if (existingIndex !== -1) {
            this.visibleUsers = [
                ...this.visibleUsers.slice(0, existingIndex),
                ownUser,
                ...this.visibleUsers.slice(existingIndex + 1)
            ];
        } else {
            this.visibleUsers = [...this.visibleUsers, ownUser];
        }
    }

    startExpirationFilter() {
        if (this.expirationCheckInterval) {
            clearInterval(this.expirationCheckInterval);
        }

        this.expirationCheckInterval = setInterval(() => {
            this.filterExpiredUsers();
        }, EXPIRATION_CHECK_INTERVAL);

        this.log('✅ Expiration filter started');
    }

    filterExpiredUsers() {
        const now = Date.now();
        const beforeCount = this.visibleUsers.length;
        
        this.visibleUsers = this.visibleUsers.filter(user => {
            const lastSeenTime = new Date(user.lastSeen).getTime();
            const age = now - lastSeenTime;
            return age < PRESENCE_EXPIRATION_MS;
        });

        const afterCount = this.visibleUsers.length;
        if (beforeCount !== afterCount) {
            this.log(`🧹 Filtered ${beforeCount - afterCount} expired users`);
        }
    }

    startTimeAgoUpdates() {
        if (this.timeAgoInterval) {
            clearInterval(this.timeAgoInterval);
        }

        this.timeAgoInterval = setInterval(() => {
            // Force reactive update
            this.visibleUsers = [...this.visibleUsers];
        }, 30000); // Every 30 seconds
    }

    startVisibilityMonitoring() {
        this.visibilityChangeHandler = () => {
            if (document.visibilityState === 'visible') {
                this.handleTabFocus();
            } else {
                this.handleTabBlur();
            }
        };

        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }

    startPresenceCleanup() {
        // Clean up stale presence every 5 minutes
        this.presenceCleanupInterval = setInterval(() => {
            this.filterExpiredUsers();
        }, 300000);
    }

    async handleRecordIdChange(newRecordId, oldRecordId) {
        if (newRecordId === oldRecordId) return;

        this.log('🔄 Case changed', { from: oldRecordId, to: newRecordId });

        // Send goodbye for old case
        if (oldRecordId) {
            try {
                await publishPresence({
                    caseId: oldRecordId,
                    sessionId: this.sessionId,
                    state: 'gone',
                    isActive: false,
                    callType: 'heartbeat'
                });
            } catch (error) {
                this.log('Error sending goodbye:', error);
            }
        }

        // Reset state
        this.visibleUsers = [];
        this.currentState = null;
        this.hasDrafts = false;
        this.caseNumber = '';
        this.caseSubject = '';

        // Load new case
        if (newRecordId) {
            await this.loadInitialPresence();
            await this.publishStateChange(this.isActive ? 'active' : 'idle');
        }
    }

    async handleTabFocus() {
        this.log('👁️ Tab gained focus');
        this.isActive = true;
        
        const newState = this.hasDrafts ? 'drafting' : 'active';
        await this.publishStateChange(newState);
        
        // Resume draft checking
        this.startDraftChecking();
    }

    async handleTabBlur() {
        this.log('👋 Tab lost focus');
        this.isActive = false;
        
        const newState = this.hasDrafts ? 'drafting' : 'idle';
        await this.publishStateChange(newState);
        
        // Stop draft checking (save API calls)
        this.stopDraftChecking();
    }

    setupBeforeUnload() {
        this.beforeUnloadHandler = () => {
            this.sendGoodbyeHeartbeat();
            this.cleanup();
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }

    sendGoodbyeHeartbeat() {
        if (!this.recordId) return;

        this.log('👋 Sending goodbye');
        
        publishPresence({
            caseId: this.recordId,
            sessionId: this.sessionId,
            state: 'gone',
            isActive: false,
            callType: 'heartbeat'
        }).catch(error => {
            console.debug('Goodbye heartbeat failed (expected during unload)');
        });
    }

    cleanup() {
        this.isComponentActive = false;

        if (this.draftCheckInterval) {
            clearInterval(this.draftCheckInterval);
        }

        if (this.expirationCheckInterval) {
            clearInterval(this.expirationCheckInterval);
        }

        if (this.timeAgoInterval) {
            clearInterval(this.timeAgoInterval);
        }

        if (this.presenceCleanupInterval) {
            clearInterval(this.presenceCleanupInterval);
        }

        if (this.subscription) {
            unsubscribe(this.subscription);
        }

        if (this.visibilityChangeHandler) {
            document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
        }

        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        }
    }

    showJoinToast(userName) {
        const event = new ShowToastEvent({
            title: 'User Joined',
            message: `${userName} is now viewing this case`,
            variant: 'info',
            mode: 'dismissable'
        });
        this.dispatchEvent(event);
    }

    showLeaveToast(userName) {
        const event = new ShowToastEvent({
            title: 'User Left',
            message: `${userName} has left this case`,
            variant: 'info',
            mode: 'dismissable'
        });
        this.dispatchEvent(event);
    }

    generateSessionId() {
        return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    getTimeAgo(lastSeenDate) {
        if (!lastSeenDate) return '';
        
        const now = Date.now();
        const lastSeen = new Date(lastSeenDate).getTime();
        const diffMs = now - lastSeen;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'just now';
        if (diffMins === 1) return '1 min ago';
        if (diffMins < 60) return `${diffMins} mins ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours === 1) return '1 hour ago';
        return `${diffHours} hours ago`;
    }

    get displayUsers() {
        return this.visibleUsers.map(user => ({
            ...user,
            timeAgo: this.getTimeAgo(user.lastSeen),
            isCurrentUser: user.userId === this.currentUserId && user.sessionId === this.sessionId,
            stateLabel: this.getStateLabel(user),
            stateIcon: this.getStateIcon(user),
            avatarClass: this.getAvatarClass(user),
            draftIndicator: user.hasDraft ? `✏️ Draft (${user.draftAgeMinutes}m)` : ''
        }));
    }

    getStateLabel(user) {
        const isActive = user.state === 'active' || user.isActive;
        
        // Focused (active)
        if (isActive) {
            // Has recent draft (< 5 mins)
            if (user.hasDraft) {
                return 'Editing';
            }
            // No draft
            return 'Active';
        }
        
        // Not focused (idle) - show time when they went idle
        const idleTime = this.formatIdleTime(user.lastSeen);
        return `Idle since ${idleTime}`;
    }

    getStateIcon(user) {
        // Only show pencil if has recent draft (< 5 mins)
        if (user.hasDraft) return '✏️';
        
        // No icon otherwise (removed circles)
        return '';
    }

    getAvatarClass(user) {
        let baseClass = 'presence-avatar';
        const isActive = user.state === 'active' || user.isActive;
        
        // Focused = 100% opacity
        if (isActive) {
            return `${baseClass} active`;
        }
        
        // Not focused = 50% opacity
        return `${baseClass} idle`;
    }
    
    formatIdleTime(lastSeenDate) {
        if (!lastSeenDate) return '';
        
        const date = new Date(lastSeenDate);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        
        return `${hours}:${minutes}`;
    }

    log(...args) {
        if (this.debugLogging) {
            console.log('[Case Presence]', ...args);
        }
    }
}