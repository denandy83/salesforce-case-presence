import { LightningElement, api, track } from 'lwc';
import { subscribe, unsubscribe, onError } from 'lightning/empApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import FORM_FACTOR from '@salesforce/client/formFactor';
import publishPresence from '@salesforce/apex/CasePresencePublisher.publishPresence';
import getSettings from '@salesforce/apex/CasePresencePublisher.getSettings';
import getCurrentUserInfo from '@salesforce/apex/CasePresencePublisher.getCurrentUserInfo';
import getCasePresence from '@salesforce/apex/CasePresenceQuery.getCasePresence';
import getAllDrafts from '@salesforce/apex/CasePresenceQuery.getAllDrafts';
import getCaseInfo from '@salesforce/apex/CasePresenceQuery.getCaseInfo';

const CHANNEL_NAME = '/event/Case_Presence__e';

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

    @api ignoreVisibility = false;
    
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
    
    // Mobile Detection
    isMobileDevice = FORM_FACTOR === 'Small' || FORM_FACTOR === 'Medium';
    
    settings;
    debugLogging = false;
    subscription;
    isComponentActive = false;
    
    // Visibility Tracking
    isIntersecting = false; 
    observer; 
    
    // Computed intervals from settings
    heartbeatInterval;
    presenceExpirationMs;
    draftStalenessMs;
    draftCheckFrequencyMs;
    expirationCheckFrequencyMs;
    
    // Mobile grace period (60 seconds)
    MOBILE_GRACE_PERIOD_MS = 60000;
    
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
    heartbeatInterval_timer = null;
    visibilityPollInterval = null;
    
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
            this.draftCheckFrequencyMs = ((this.settings?.draftCheckIntervalSeconds || 10) * 1000);
            this.expirationCheckFrequencyMs = ((this.settings?.expirationCheckIntervalSeconds || 10) * 1000);
            
            // Parse user badge settings once
            this.parsedVipUsers = this.settings?.vipUsers?.toLowerCase().split(',').map(u => u.trim()) || [];
            this.parsedKeyUsers = this.settings?.keyUsers?.toLowerCase().split(',').map(u => u.trim()) || [];
            this.parsedNormalUsers = this.settings?.normalUsers?.toLowerCase().split(',').map(u => u.trim()) || [];
            this.vipBadge = this.settings?.vipBadge || '👑';
            this.keyBadge = this.settings?.keyBadge || '⭐';
            this.normalBadge = this.settings?.normalBadge || '👤';
            
            this.log('🚀 Component initialized', () => ({ 
                recordId: this.recordId,
                userId: this.currentUserId,
                isMobile: this.isMobileDevice
            }));
            
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
            
            // Initial visibility check
            this.checkVisibility();
            
            // Start periodic tasks
            this.startHeartbeat(); 
            this.startExpirationFilter();
            this.startVisibilityMonitoring();
            this.setupBeforeUnload();
            
            // Start Visibility Poller (Safety net for iframe focus issues, e.g. Email Composer)
            // If focus is inside an iframe (like CKEditor), the 'blur' event might not bubble to us.
            // This polling ensures we catch the loss of focus when the user Alt-Tabs.
            this.visibilityPollInterval = setInterval(() => {
                this.checkVisibility();
            }, 2000);
            
        } catch (error) {
            console.error('Error initializing component:', error);
        }
    }

    renderedCallback() {
        if (this.observer) return;

        const options = {
            root: null,
            rootMargin: '0px',
            threshold: 0.01
        };

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                this.isIntersecting = entry.isIntersecting;
                this.log('👁️ Intersection changed:', this.isIntersecting);
                this.checkVisibility();
            });
        }, options);

        if (this.template.host) {
            this.observer.observe(this.template.host);
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
            
            const [caseInfo, presence, drafts] = await Promise.all([
                getCaseInfo({ caseId: this.recordId }),
                getCasePresence({ caseId: this.recordId }),
                getAllDrafts({ caseId: this.recordId })
            ]);

            if (!this.isComponentActive) return;
            
            if (caseInfo) {
                this.caseNumber = caseInfo.caseNumber;
                this.caseSubject = caseInfo.caseSubject;
            }
            
            if (this.isComponentActive) {
                this.visibleUsers = presence;
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
            this.handlePresenceEvent(payload);
        };

        try {
            const response = await subscribe(CHANNEL_NAME, -1, messageCallback);
            this.subscription = response;
        } catch (error) {
            console.error('Error subscribing to Platform Events:', error);
        }

        onError(error => {
            console.error('EMP API Error:', error);
        });
    }

    handlePresenceEvent(payload) {
        if (payload.UserId__c === this.currentUserId) return;
        if (payload.CaseId__c !== this.recordId) return;

        const existingUserIndex = this.visibleUsers.findIndex(
            u => u.userId === payload.UserId__c
        );

        if (payload.State__c === 'gone') {
            // Mobile Specific Logic: Ignore 'gone' for 60 seconds
            if (payload.IsMobile__c) {
                this.log('📱 Mobile user sent GONE - applying grace period', payload.UserName__c);
                const user = {
                    userId: payload.UserId__c,
                    userName: payload.UserName__c,
                    userPhotoUrl: payload.UserPhotoUrl__c,
                    state: 'gone',
                    lastSeen: new Date(payload.Timestamp__c),
                    hasDraft: payload.HasDraft__c || false,
                    isMobile: true
                };

                if (existingUserIndex !== -1) {
                    this.visibleUsers = [
                        ...this.visibleUsers.slice(0, existingUserIndex),
                        user,
                        ...this.visibleUsers.slice(existingUserIndex + 1)
                    ];
                } else {
                    // New mobile user but already leaving - still add for 60s grace period
                    this.visibleUsers = [...this.visibleUsers, user];
                }
                return;
            }

            // Normal user or non-grace period logic
            if (existingUserIndex !== -1) {
                const user = this.visibleUsers[existingUserIndex];
                if (document.visibilityState === 'visible' && this.settings?.showLeaveToasts) {
                    this.showLeaveToast(user.userName);
                }
                this.visibleUsers = this.visibleUsers.filter((_, i) => i !== existingUserIndex);
            }
        } else {
            const user = {
                userId: payload.UserId__c,
                userName: payload.UserName__c,
                userPhotoUrl: payload.UserPhotoUrl__c,
                state: payload.State__c,
                lastSeen: new Date(payload.Timestamp__c),
                hasDraft: payload.HasDraft__c || false,
                isMobile: payload.IsMobile__c || false
            };

            if (existingUserIndex !== -1) {
                const existingUser = this.visibleUsers[existingUserIndex];
                const hadDraft = existingUser.hasDraft || false;
                const nowHasDraft = payload.HasDraft__c || false;
                
                this.visibleUsers = [
                    ...this.visibleUsers.slice(0, existingUserIndex),
                    user,
                    ...this.visibleUsers.slice(existingUserIndex + 1)
                ];
                
                if (document.visibilityState === 'visible') {
                    if (!hadDraft && nowHasDraft && this.settings?.showEditStartToasts) {
                        this.showEditingToast(user.userName);
                    } else if (hadDraft && !nowHasDraft && this.settings?.showEditStopToasts) {
                        this.showStoppedEditingToast(user.userName);
                    }
                }
            } else {
                this.visibleUsers = [...this.visibleUsers, user];
                if (document.visibilityState === 'visible' && this.settings?.showJoinToasts) {
                    this.showJoinToast(user.userName);
                }
            }
        }
    }

    checkVisibility() {
        const isTabVisible = document.visibilityState === 'visible';
        const isWindowFocused = document.hasFocus();
        
        // Check if the component is actually in the active Salesforce workspace tab
        // If width/height is 0, it's hidden (e.g. user is on a different Salesforce tab)
        const rect = this.template.host.getBoundingClientRect();
        const isOnActiveTab = rect.width > 0 || rect.height > 0;
        
        const isComponentVisible = this.isIntersecting || (this.ignoreVisibility && isOnActiveTab);

        const shouldBeActive = isTabVisible && isWindowFocused && isComponentVisible;

        if (this.isActive !== shouldBeActive) {
            if (shouldBeActive) {
                this.handleBecomeActive();
            } else {
                this.handleBecomeIdle();
            }
        }
    }

    startVisibilityMonitoring() {
        this.visibilityChangeHandler = () => this.checkVisibility();
        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
        
        this.windowBlurHandler = () => {
            setTimeout(() => this.checkVisibility(), 100);
        };
        this.windowFocusHandler = () => {
            this.checkVisibility();
        };

        window.addEventListener('blur', this.windowBlurHandler);
        window.addEventListener('focus', this.windowFocusHandler);
    }

    async handleBecomeActive() {
        if (this.isActive) return;
        this.log('🟢 Switching to ACTIVE');
        this.isActive = true;
        
        await this.publishStateChange('active');
        this.startDraftChecking();
    }

    async handleBecomeIdle() {
        if (!this.isActive) return;
        this.log('⚪ Switching to IDLE');
        
        // 1. Optimistic Update: Set IDLE immediately to beat the browser freeze
        this.isActive = false;
        this.stopDraftChecking();
        
        // 2. Fire initial 'Idle' signal immediately (don't await)
        // This ensures the user looks idle even if the subsequent network call gets throttled
        this.publishStateChange('idle').catch(e => console.error(e));
        
        // 3. Perform the final draft check
        // If this finds a change, checkDrafts will call publishStateChange again
        // causing a second update: "Idle + Has Draft"
        await this.checkDrafts();
    }

    startDraftChecking() {
        if (this.draftCheckInterval) clearInterval(this.draftCheckInterval);

        this.checkDrafts();
        this.draftCheckInterval = setInterval(() => {
            if (!this.isActive) return;
            this.checkDrafts();
        }, this.draftCheckFrequencyMs);
    }

    stopDraftChecking() {
        if (this.draftCheckInterval) {
            clearInterval(this.draftCheckInterval);
            this.draftCheckInterval = null;
        }
    }

    async checkDrafts() {
        if (!this.recordId || !this.isComponentActive) return;

        try {
            const drafts = await getAllDrafts({ caseId: this.recordId });
            if (!this.isComponentActive) return;
            
            this.log('Drafts found:', drafts);

            const hasMyDrafts = drafts.some(d => d.userId === this.currentUserId);
            this.log('Has my drafts?', hasMyDrafts, 'Current User:', this.currentUserId);

            const oldHasDrafts = this.hasDrafts;
            this.hasDrafts = hasMyDrafts;

            if (oldHasDrafts !== this.hasDrafts) {
                this.log('Draft status changed, publishing update...');
                await this.publishStateChange(this.isActive ? 'active' : 'idle');
            }
        } catch (error) {
            if (this.isComponentActive) {
                console.error('Error checking drafts:', error);
            }
        }
    }

    startHeartbeat() {
        if (this.heartbeatInterval_timer) clearInterval(this.heartbeatInterval_timer);

        this.heartbeatInterval_timer = setInterval(() => {
            // Only send heartbeat if ACTIVE
            if (this.isActive && this.recordId) {
                this.publishStateChange('active');
            }
        }, this.heartbeatInterval);
    }

    async publishStateChange(newState) {
        if (!this.recordId || !this.isComponentActive) return;
        
        this.currentState = newState;
        this.lastPublishedDraftStatus = this.hasDrafts;
        
        try {
            await publishPresence({
                caseId: this.recordId,
                state: newState,
                hasDraft: this.hasDrafts,
                callType: 'heartbeat',
                isMobile: !!this.isMobileDevice
            });
        } catch (error) {
            if (this.isComponentActive) {
                console.error('Error publishing state change:', error);
            }
        }
    }

    startExpirationFilter() {
        if (this.expirationCheckInterval) clearInterval(this.expirationCheckInterval);

        this.expirationCheckInterval = setInterval(() => {
            this.filterExpiredUsers();
        }, this.expirationCheckFrequencyMs);
    }

    filterExpiredUsers() {
        const now = Date.now();
        const beforeCount = this.visibleUsers.length;
        
        this.visibleUsers = this.visibleUsers.filter(user => {
            const lastSeenTime = new Date(user.lastSeen).getTime();
            const age = now - lastSeenTime;
            
            // Special rule for Mobile users: Always expire after 60s
            // This handles both 'gone' state grace period AND hard disconnects (no heartbeat)
            if (user.isMobile) {
                return age < this.MOBILE_GRACE_PERIOD_MS;
            }
            
            return age < this.presenceExpirationMs;
        });

        const afterCount = this.visibleUsers.length;
        if (beforeCount !== afterCount) {
            this.log(`🧹 Filtered ${beforeCount - afterCount} users`);
        }
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
        // Fire and forget
        publishPresence({
            caseId: this.recordId,
            state: 'gone',
            hasDraft: false,
            callType: 'heartbeat',
            isMobile: !!this.isMobileDevice
        }).catch(() => {});
    }

    cleanup() {
        this.isComponentActive = false;
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.heartbeatInterval_timer) clearInterval(this.heartbeatInterval_timer);
        if (this.draftCheckInterval) clearInterval(this.draftCheckInterval);
        if (this.expirationCheckInterval) clearInterval(this.expirationCheckInterval);
        if (this.subscription) unsubscribe(this.subscription);
        if (this.visibilityChangeHandler) document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
        if (this.windowBlurHandler) window.removeEventListener('blur', this.windowBlurHandler);
        if (this.windowFocusHandler) window.removeEventListener('focus', this.windowFocusHandler);
        if (this.beforeUnloadHandler) window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }

    // UI Helpers
    handleAvatarHover(event) {
        const userId = event.currentTarget.dataset.userid;
        const tooltip = this.template.querySelector(`.custom-tooltip[data-userid="${userId}"]`);
        
        if (tooltip) {
            const rect = event.currentTarget.getBoundingClientRect();
            
            // Calculate position: Fixed coordinates
            // Center horizontally: rect.left + width/2
            // Bottom align: rect.top - margin
            const left = rect.left + (rect.width / 2);
            const top = rect.top - 30; // 30px spacing for badge
            
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            // Add transform for centering and moving up (handled in CSS usually, but setting here explicitly)
            tooltip.style.transform = 'translate(-50%, -100%)';
            
            tooltip.classList.add('visible');
        }
    }

    handleAvatarLeave(event) {
        const userId = event.currentTarget.dataset.userid;
        const tooltip = this.template.querySelector(`.custom-tooltip[data-userid="${userId}"]`);
        if (tooltip) {
            tooltip.classList.remove('visible');
        }
    }

    showJoinToast(userName) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'User Joined',
            message: `${userName} is now viewing this case`,
            variant: 'info',
            mode: 'dismissable'
        }));
    }

    showLeaveToast(userName) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'User Left',
            message: `${userName} has left this case`,
            variant: 'info',
            mode: 'dismissable'
        }));
    }

    showEditingToast(userName) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Started Editing',
            message: `${userName} is now editing this case`,
            variant: 'info',
            mode: 'dismissable'
        }));
    }

    showStoppedEditingToast(userName) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Stopped Editing',
            message: `${userName} has stopped editing this case`,
            variant: 'info',
            mode: 'dismissable'
        }));
    }

    get hasVisibleUsers() {
        return this.visibleUsers && this.visibleUsers.length > 0;
    }

    get isMobile() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    get displayedUsers() {
        const vipUsers = this.parsedVipUsers;
        const keyUsers = this.parsedKeyUsers;
        
        const mappedUsers = this.visibleUsers.map(user => {
            // Rule: Opacity 100% if Active OR if Mobile (regardless of state)
            let opacity = '0.5';
            if (user.state === 'active' || user.isMobile) {
                opacity = '1';
            }
            
            const fullName = user.userName || '';
            const firstName = fullName.split(' ')[0];
            const userNameLower = firstName.toLowerCase();
            let badge = null;
            
            if (vipUsers.includes(userNameLower)) badge = this.vipBadge;
            else if (keyUsers.includes(userNameLower)) badge = this.keyBadge;
            else if (this.parsedNormalUsers.includes(userNameLower)) badge = this.normalBadge;
            
            return {
                ...user,
                firstName: firstName,
                stateLabel: this.getStateLabel(user),
                isEditing: user.hasDraft,
                containerStyle: `opacity: ${opacity};`,
                photoClass: `avatar-photo ${user.hasDraft ? 'editing' : ''}`,
                badge: badge,
                showMobileIcon: user.isMobile
            };
        });
        return this.isMobile ? mappedUsers : mappedUsers.slice(0, 5);
    }
    
    get showAdditionalCount() {
        return !this.isMobile && this.visibleUsers.length > 5;
    }
    
    get additionalCount() {
        return this.visibleUsers.length > 5 ? this.visibleUsers.length - 5 : 0;
    }
    
    get mobileUserList() {
        return this.visibleUsers.map(user => {
            let name = user.userName || 'Unknown';
            // Use black filled square for mobile users, circle for others
            const indicator = user.isMobile ? '■' : (user.state === 'active' ? '●' : '○');
            const draft = user.hasDraft ? ' ✏️' : '';
            const mobile = user.isMobile ? ' 📱' : '';
            return `${indicator} ${name}${draft}${mobile}`;
        }).join(', ');
    }

    getStateLabel(user) {
        // Mobile users always show as Active until they are removed
        if (user.isMobile) {
            return user.hasDraft ? 'Editing' : 'Active';
        }

        if (user.state === 'active') {
            return user.hasDraft ? 'Editing' : 'Active';
        }
        return `Idle since ${this.formatIdleTime(user.lastSeen)}`;
    }
    
    formatIdleTime(lastSeenDate) {
        if (!lastSeenDate) return '';
        const date = new Date(lastSeenDate);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    log(message, ...args) {
        if (this.debugLogging) {
            const processedArgs = args.map(arg => typeof arg === 'function' ? arg() : arg);
            console.log('[Case Presence]', message, ...processedArgs);
        }
    }
}