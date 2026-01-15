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
const DRAFT_CHECK_INTERVAL = 10000; // 10 seconds (kept as constant)
const EXPIRATION_CHECK_INTERVAL = 10000; // 10 seconds (kept as constant)

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
    
    currentUserId;
    currentUserName;
    currentState = null;
    lastPublishedDraftStatus = false;
    hasDrafts = false;
    isActive = true;
    
    settings;
    debugLogging = false;
    subscription;
    isComponentActive = false;
    
    // Computed intervals from settings
    heartbeatInterval;
    presenceExpirationMs;
    draftStalenessMs;
    
    // Parsed settings (computed once, not on every render)
    parsedVipUsers = [];
    parsedKeyUsers = [];
    parsedNormalUsers = [];
    vipBadge = '👑';
    keyBadge = '⭐';
    normalBadge = '👤';
    
    // Intervals
    draftCheckInterval = null;
    expirationCheckInterval = null;
    presenceCleanupInterval = null;
    visibilityPollingInterval = null;
    heartbeatInterval_timer = null;
    visibilityTimer = null;
    
    // Handlers
    visibilityChangeHandler = null;
    windowBlurHandler = null;
    windowFocusHandler = null;
    beforeUnloadHandler = null;

    async connectedCallback() {
        this.isComponentActive = true;
        
        try {
            // Load settings
            this.settings = await getSettings();
            this.debugLogging = this.settings?.enableDebugLogging || false;
            
            // Compute intervals from settings
            this.heartbeatInterval = ((this.settings?.heartbeatFrequencySeconds || 240) * 1000);
            this.presenceExpirationMs = ((this.settings?.presenceExpirationMinutes || 10) * 60 * 1000);
            this.draftStalenessMs = ((this.settings?.draftStalenessMinutes || 5) * 60 * 1000);
            
            // Parse user badge settings once
            this.parsedVipUsers = this.settings?.vipUsers?.toLowerCase().split(',').map(u => u.trim()) || [];
            this.parsedKeyUsers = this.settings?.keyUsers?.toLowerCase().split(',').map(u => u.trim()) || [];
            this.parsedNormalUsers = this.settings?.normalUsers?.toLowerCase().split(',').map(u => u.trim()) || [];
            this.vipBadge = this.settings?.vipBadge || '👑';
            this.keyBadge = this.settings?.keyBadge || '⭐';
            this.normalBadge = this.settings?.normalBadge || '👤';
            
            this.log('🚀 Component initialized', { 
                recordId: this.recordId,
                userId: this.currentUserId,
                heartbeatInterval: this.heartbeatInterval,
                presenceExpiration: this.presenceExpirationMs,
                draftStaleness: this.draftStalenessMs
            });
            
            // Get current user info
            const userInfo = await getCurrentUserInfo();
            this.currentUserId = userInfo.userId;
            this.currentUserName = userInfo.userName;
            
            // Load initial presence data
            if (this.recordId) {
                await this.loadInitialPresence();
            }
            
            // Subscribe to Platform Events
            await this.subscribeToPlatformEvents();
            
            // Publish initial presence
            this.isActive = document.visibilityState === 'visible';
            this.log('📍 Initial visibility state:', {
                visibilityState: document.visibilityState,
                hidden: document.hidden,
                isActive: this.isActive
            });
            await this.publishStateChange(this.isActive ? 'active' : 'idle');
            
            // Start periodic tasks
            if (this.isActive) {
                this.startDraftChecking();
            }
            this.startHeartbeat();
            this.startExpirationFilter();
            this.startPresenceCleanup();
            this.startVisibilityMonitoring();
            this.startVisibilityPolling();
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
            
            // Display immediately
            if (this.isComponentActive) {
                this.visibleUsers = presence;
                
                // Check if current user has drafts
                const drafts = await getAllDrafts({ caseId: this.recordId });
                if (!this.isComponentActive) return;
                
                this.hasDrafts = drafts.some(d => d.userId === this.currentUserId);
            }
            
        } catch (error) {
            if (this.isComponentActive) {
                console.error('Error loading initial presence:', error);
            }
        }
    }

    async subscribeToPlatformEvents() {
        const messageCallback = (response) => {
            const payload = response.data.payload;
            this.log('📨 Platform Event Received:', {
                caseId: payload.CaseId__c,
                userId: payload.UserId__c,
                userName: payload.UserName__c,
                state: payload.State__c
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
        // Ignore own events
        if (payload.UserId__c === this.currentUserId) {
            this.log('⏭️ Ignoring own event');
            return;
        }

        // Only process events for current case
        if (payload.CaseId__c !== this.recordId) {
            this.log('⏭️ Event for different case');
            return;
        }

        const existingUserIndex = this.visibleUsers.findIndex(
            u => u.userId === payload.UserId__c
        );

        if (payload.State__c === 'gone') {
            // User left
            if (existingUserIndex !== -1) {
                const user = this.visibleUsers[existingUserIndex];
                // Show toast if enabled and this tab is active
                if (this.isActive && document.visibilityState === 'visible' && this.settings?.showLeaveToasts) {
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
                lastSeen: new Date(payload.Timestamp__c),
                hasDraft: payload.HasDraft__c || false
            };

            if (existingUserIndex !== -1) {
                // Update existing user
                const existingUser = this.visibleUsers[existingUserIndex];
                const hadDraft = existingUser.hasDraft || false;
                const nowHasDraft = payload.HasDraft__c || false;
                
                this.visibleUsers = [
                    ...this.visibleUsers.slice(0, existingUserIndex),
                    user,
                    ...this.visibleUsers.slice(existingUserIndex + 1)
                ];
                
                // Show toast if enabled and draft status changed
                if (this.isActive && document.visibilityState === 'visible') {
                    if (!hadDraft && nowHasDraft && this.settings?.showEditStartToasts) {
                        this.showEditingToast(user.userName);
                    } else if (hadDraft && !nowHasDraft && this.settings?.showEditStopToasts) {
                        this.showStoppedEditingToast(user.userName);
                    }
                }
                
                this.log('🔄 User updated:', payload.UserName__c, { hadDraft, nowHasDraft });
            } else {
                // New user - show toast if enabled
                this.visibleUsers = [...this.visibleUsers, user];
                if (this.isActive && document.visibilityState === 'visible' && this.settings?.showJoinToasts) {
                    this.showJoinToast(user.userName);
                }
                this.log('👋 User joined:', payload.UserName__c);
            }
        }
    }

    startDraftChecking() {
        if (this.draftCheckInterval) {
            clearInterval(this.draftCheckInterval);
        }

        this.log('🔍 Starting initial draft check');
        this.checkDrafts();

        this.draftCheckInterval = setInterval(() => {
            this.log('⏰ 10-second draft check timer fired');
            if (!this.isActive || !this.recordId) {
                this.log('⏸️ Skipping draft check - isActive:', this.isActive, 'recordId:', !!this.recordId);
                return;
            }
            this.checkDrafts();
        }, DRAFT_CHECK_INTERVAL);

        this.log('✅ Draft checking started (10 second interval)');
    }

    stopDraftChecking() {
        if (this.draftCheckInterval) {
            clearInterval(this.draftCheckInterval);
            this.draftCheckInterval = null;
            this.log('⏹️ Draft checking stopped');
        }
    }

    startHeartbeat() {
        if (this.heartbeatInterval_timer) {
            clearInterval(this.heartbeatInterval_timer);
        }

        this.heartbeatInterval_timer = setInterval(() => {
            const currentState = this.isActive ? 'active' : 'idle';
            if (this.isActive && this.recordId) {
                this.log(`💓 Keep-alive heartbeat: ${currentState}`);
                this.publishStateChange(currentState);
            } else {
                this.log(`⏸️ Heartbeat skipped - isActive: ${this.isActive}`);
            }
        }, this.heartbeatInterval);

        this.log('✅ Heartbeat started (' + (this.heartbeatInterval/1000) + ' second interval)');
    }

    async checkDrafts() {
        if (!this.recordId || !this.isComponentActive) return;

        try {
            this.log('🔍 Checking drafts for case:', this.recordId);
            const drafts = await getAllDrafts({ caseId: this.recordId });
            if (!this.isComponentActive) return;

            this.log('✉️ Draft query returned:', drafts);

            const myDrafts = drafts.filter(d => d.userId === this.currentUserId);
            this.log('📝 My drafts:', myDrafts);

            const oldHasDrafts = this.hasDrafts;
            this.hasDrafts = myDrafts.length > 0;

            if (oldHasDrafts !== this.hasDrafts) {
                this.log(`📝 Draft status changed: ${oldHasDrafts} → ${this.hasDrafts}`);
                await this.publishStateChange(this.isActive ? 'active' : 'idle');
            }

        } catch (error) {
            if (this.isComponentActive) {
                console.error('Error checking drafts:', error);
            }
        }
    }

    async publishStateChange(newState) {
        if (!this.recordId || !this.isComponentActive) return;

        // Check if both state AND draft status are unchanged
        if (newState === this.currentState && this.lastPublishedDraftStatus === this.hasDrafts) {
            this.log('⏭️ State and draft unchanged, skipping publish');
            return;
        }

        this.currentState = newState;
        this.lastPublishedDraftStatus = this.hasDrafts;
        
        try {
            await publishPresence({
                caseId: this.recordId,
                state: newState,
                hasDraft: this.hasDrafts,
                callType: 'heartbeat'
            });
            
            if (!this.isComponentActive) return;
            
            this.log(`📤 Published state change: ${newState}`, { hasDraft: this.hasDrafts });
            
        } catch (error) {
            if (this.isComponentActive) {
                console.error('Error publishing state change:', error);
            }
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
            return age < this.presenceExpirationMs;
        });

        const afterCount = this.visibleUsers.length;
        if (beforeCount !== afterCount) {
            this.log(`🧹 Filtered ${beforeCount - afterCount} expired users`);
        }
    }

    startPresenceCleanup() {
        if (this.presenceCleanupInterval) {
            clearInterval(this.presenceCleanupInterval);
        }

        this.presenceCleanupInterval = setInterval(() => {
            this.visibleUsers = this.visibleUsers.filter(user => {
                const age = Date.now() - new Date(user.lastSeen).getTime();
                return age < this.presenceExpirationMs;
            });
        }, 60000); // Every minute

        this.log('✅ Presence cleanup started');
    }

    startVisibilityMonitoring() {
        this.log('🔧 Setting up visibility monitoring');
        
        // Browser tab visibility
        this.visibilityChangeHandler = () => {
            this.log('👁️ Browser tab visibility changed!', {
                visibilityState: document.visibilityState,
                hidden: document.hidden,
                wasActive: this.isActive
            });
            
            if (document.visibilityState === 'hidden') {
                this.log('🚫 Browser tab hidden - going idle');
                if (this.isActive) {
                    this.handleTabBlur();
                }
            } else if (document.visibilityState === 'visible') {
                this.log('✅ Browser tab visible - checking component visibility');
            }
        };

        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
        
        // Window blur/focus
        this.windowBlurHandler = () => {
            this.log('🪟 Window BLUR event fired', {
                documentHasFocus: document.hasFocus(),
                visibilityState: document.visibilityState,
                isActive: this.isActive
            });
            
            setTimeout(() => {
                const documentHasFocus = document.hasFocus();
                const visibilityState = document.visibilityState;
                
                this.log('📋 After 100ms delay:', {
                    documentHasFocus,
                    visibilityState,
                    isActive: this.isActive
                });
                
                if (!documentHasFocus) {
                    this.log('🪟 Window BLUR confirmed - switching to another window/app');
                    if (this.isActive) {
                        this.handleTabBlur();
                    } else {
                        this.log('Already idle/gone, no action needed');
                    }
                } else {
                    this.log('🪟 Window BLUR ignored - focus moved within Salesforce page');
                }
            }, 100);
        };
        
        this.windowFocusHandler = () => {
            this.log('🪟 Window FOCUS - returned to this window');
            
            if (!this.isActive && document.visibilityState === 'visible') {
                const element = this.template.host;
                if (element) {
                    const rect = element.getBoundingClientRect();
                    const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
                    
                    if (isVisible) {
                        this.log('✅ Window focused and component visible - becoming active');
                        this.handleTabFocus();
                    } else {
                        this.log('⏭️ Window focused but component not visible - staying idle');
                    }
                } else {
                    this.log('⚠️ Could not check component visibility');
                }
            } else {
                this.log('⏭️ Already active or document hidden');
            }
        };

        window.addEventListener('blur', this.windowBlurHandler);
        window.addEventListener('focus', this.windowFocusHandler);

        this.log('✅ Visibility monitoring started (tab + window)');
    }

    startVisibilityPolling() {
        this.log('🔧 Starting visibility polling (checks every 2s)');
        
        this.visibilityPollingInterval = setInterval(() => {
            if (!this.isComponentActive) return;
            
            // Only poll if active or browser tab is visible
            const shouldPoll = this.isActive || document.visibilityState === 'visible';
            
            if (!shouldPoll) {
                return;
            }
            
            const element = this.template.host;
            if (!element) return;
            
            // Check document focus
            const documentHasFocus = document.hasFocus();
            const browserTabVisible = document.visibilityState === 'visible';
            
            // Check component visibility
            const rect = element.getBoundingClientRect();
            const isInViewport = rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
            
            // Check computed style
            const style = window.getComputedStyle(element);
            const isStyleVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            
            const isActuallyVisible = isInViewport && isStyleVisible;
            
            // Should be active if visible, tab visible, and has focus
            const shouldBeActive = isActuallyVisible && browserTabVisible && documentHasFocus;
            
            const stateWillChange = (shouldBeActive && !this.isActive) || (!shouldBeActive && this.isActive);
            
            if (stateWillChange) {
                this.log('🔎 Visibility poll (state change detected):', {
                    caseId: this.recordId ? this.recordId.substring(0, 8) + '...' : 'none',
                    isInViewport: isInViewport,
                    isStyleVisible: isStyleVisible,
                    documentHasFocus: documentHasFocus,
                    browserTabVisible: browserTabVisible,
                    currentlyActive: this.isActive,
                    shouldBeActive: shouldBeActive
                });
            }
            
            if (shouldBeActive && !this.isActive) {
                this.log('✅ Polling detected component became visible - becoming active');
                this.handleTabFocus();
            } else if (!shouldBeActive && this.isActive) {
                if (!documentHasFocus) {
                    this.log('❌ Polling detected document lost focus - going idle (app/window switch)');
                    this.handleTabBlur();
                } else if (!isActuallyVisible) {
                    this.log('❌ Polling detected component became hidden - going idle (workspace tab switch)');
                    this.handleWorkspaceTabSwitch();
                } else {
                    this.log('❌ Polling detected state change - going idle');
                    this.handleTabBlur();
                }
            }
        }, 2000);
        
        this.log('✅ Visibility polling started');
    }

    async handleRecordIdChange(newRecordId, oldRecordId) {
        if (newRecordId === oldRecordId) return;

        this.log('🔄 Case changed', { from: oldRecordId, to: newRecordId });

        // Send goodbye for old case
        if (oldRecordId) {
            try {
                await publishPresence({
                    caseId: oldRecordId,
                    state: 'gone',
                    hasDraft: false,
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
        this.log('👁️ Tab gained focus - switching to active');
        this.isActive = true;
        
        const newState = 'active';
        this.log(`📤 About to publish state: ${newState}`);
        await this.publishStateChange(newState);
        this.log(`✅ State published: ${newState}`);
        
        this.startDraftChecking();
    }

    async handleTabBlur() {
        this.log('👋 Tab lost focus - switching to idle');
        
        this.log('🔍 Final draft check before going idle');
        await this.checkDrafts();
        
        this.isActive = false;
        
        const newState = 'idle';
        this.log(`📤 About to publish state: ${newState}`);
        await this.publishStateChange(newState);
        this.log(`✅ State published: ${newState}`);
        
        this.stopDraftChecking();
    }

    async handleWorkspaceTabSwitch() {
        this.log('🔄 Workspace tab switched - going idle (not viewing this case)');
        
        this.log('🔍 Final draft check before going idle');
        await this.checkDrafts();
        
        this.isActive = false;
        
        const newState = 'idle';
        this.log(`📤 About to publish state: ${newState}`);
        await this.publishStateChange(newState);
        this.log(`✅ State published: ${newState}`);
        
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
            state: 'gone',
            hasDraft: false,
            callType: 'heartbeat'
        }).catch(error => {
            console.debug('Goodbye heartbeat failed (expected during unload)');
        });
    }

    cleanup() {
        this.isComponentActive = false;

        if (this.visibilityTimer) {
            clearTimeout(this.visibilityTimer);
        }

        if (this.visibilityPollingInterval) {
            clearInterval(this.visibilityPollingInterval);
        }

        if (this.heartbeatInterval_timer) {
            clearInterval(this.heartbeatInterval_timer);
        }

        if (this.draftCheckInterval) {
            clearInterval(this.draftCheckInterval);
        }

        if (this.expirationCheckInterval) {
            clearInterval(this.expirationCheckInterval);
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

        if (this.windowBlurHandler) {
            window.removeEventListener('blur', this.windowBlurHandler);
        }

        if (this.windowFocusHandler) {
            window.removeEventListener('focus', this.windowFocusHandler);
        }

        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        }
    }

    handleAvatarHover(event) {
        const userId = event.currentTarget.dataset.userid;
        const tooltip = this.template.querySelector(`.custom-tooltip[data-userid="${userId}"]`);
        
        if (tooltip) {
            // Position tooltip near cursor
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.style.display = 'block';
            tooltip.style.left = rect.left + 'px';
            tooltip.style.top = (rect.top - 40) + 'px'; // 40px above avatar
        }
    }

    handleAvatarLeave(event) {
        const userId = event.currentTarget.dataset.userid;
        const tooltip = this.template.querySelector(`.custom-tooltip[data-userid="${userId}"]`);
        
        if (tooltip) {
            tooltip.style.display = 'none';
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

    showEditingToast(userName) {
        const event = new ShowToastEvent({
            title: 'Started Editing',
            message: `${userName} is now editing this case`,
            variant: 'info',
            mode: 'dismissable'
        });
        this.dispatchEvent(event);
    }

    showStoppedEditingToast(userName) {
        const event = new ShowToastEvent({
            title: 'Stopped Editing',
            message: `${userName} has stopped editing this case`,
            variant: 'info',
            mode: 'dismissable'
        });
        this.dispatchEvent(event);
    }

    get hasVisibleUsers() {
        return this.visibleUsers && this.visibleUsers.length > 0;
    }

    get isMobile() {
        // Detect mobile form factor
        return window.matchMedia('(max-width: 768px)').matches;
    }

    get displayedUsers() {
        // Use pre-parsed settings
        const vipUsers = this.parsedVipUsers;
        const keyUsers = this.parsedKeyUsers;
        const normalUsers = this.parsedNormalUsers;
        
        const vipBadge = this.vipBadge;
        const keyBadge = this.keyBadge;
        const normalBadge = this.normalBadge;
        
        // Map users with computed properties
        const mappedUsers = this.visibleUsers.map(user => {
            const isActive = user.state === 'active';
            const opacity = isActive ? '1' : '0.5';
            
            // Extract first name
            const fullName = user.userName || '';
            const firstName = fullName.split(' ')[0];
            
            // Assign badge based on first name
            const userNameLower = firstName.toLowerCase();
            let badge = null;
            
            if (vipUsers.includes(userNameLower)) {
                badge = vipBadge;
            } else if (keyUsers.includes(userNameLower)) {
                badge = keyBadge;
            } else if (normalUsers.includes(userNameLower)) {
                badge = normalBadge;
            }
            
            return {
                ...user,
                firstName: firstName,
                stateLabel: this.getStateLabel(user),
                isEditing: user.hasDraft,
                style: `opacity: ${opacity};`,
                badge: badge
            };
        });
        
        // Limit to 5 users on desktop
        return this.isMobile ? mappedUsers : mappedUsers.slice(0, 5);
    }
    
    get additionalCount() {
        return this.visibleUsers.length > 5 ? this.visibleUsers.length - 5 : 0;
    }
    
    get showAdditionalCount() {
        return !this.isMobile && this.additionalCount > 0;
    }
    
    get mobileUserList() {
        return this.visibleUsers.map(user => {
            let name = user.userName || 'Unknown';
            const state = user.state === 'active' ? '●' : '○';
            const draft = user.hasDraft ? ' ✏️' : '';
            return `${state} ${name}${draft}`;
        }).join(', ');
    }

    getStateLabel(user) {
        const isActive = user.state === 'active';
        
        if (isActive) {
            if (user.hasDraft) {
                return 'Editing';
            }
            return 'Active';
        }
        
        // Idle - show time
        const idleTime = this.formatIdleTime(user.lastSeen);
        return `Idle since ${idleTime}`;
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