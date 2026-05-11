(() => {
    const escapeHtml = (str) => {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/\//g, '&#x2F;');
    };

    const resolveApiUrl = () => {
        if (typeof window === 'undefined' || !window.location) return 'https://tobebe.online/api.php';
        const protocol = window.location.protocol || '';
        const host = window.location.hostname || '';
        if (protocol.startsWith('http') && host && host !== 'tobebe.online') {
            return `${window.location.origin}/api.php`;
        }
        if (host === 'tobebe.online') {
            return 'https://tobebe.online/api.php';
        }
        return 'https://tobebe.online/api.php';
    };
    const defaultApiUrl = resolveApiUrl();
    window.TobebeCallsRuntimeApiUrl = defaultApiUrl;

    const readJsonResponse = async (response) => {
        const text = await response.text();
        let data = null;
        try {
            data = JSON.parse(text || '{}');
        } catch {
            data = {
                success: false,
                message: `Некорректный ответ сервера (${response.status})`
            };
        }
        if (!response.ok && !data?.message) {
            data = { success: false, message: `HTTP ${response.status}` };
        }
        return data;
    };

    const postJson = async (apiUrl, action, payload, retryCount = 0) => {
        const maxRetries = 3;
        try {
            const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
                signal: AbortSignal.timeout(30000)
            });
            return readJsonResponse(response);
        } catch (error) {
            console.error(`POST request error for action ${action} (attempt ${retryCount + 1}/${maxRetries}):`, error);
            if (retryCount < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                return postJson(apiUrl, action, payload, retryCount + 1);
            }
            return { success: false, message: 'Сетевая ошибка при запросе к серверу: ' + (error.message || 'Unknown error') };
        }
    };

    const getJson = async (apiUrl, action, query = {}, retryCount = 0) => {
        const maxRetries = 3;
        try {
            const params = new URLSearchParams(query);
            const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}&${params.toString()}`, {
                signal: AbortSignal.timeout(30000)
            });
            return readJsonResponse(response);
        } catch (error) {
            console.error(`GET request error for action ${action} (attempt ${retryCount + 1}/${maxRetries}):`, error);
            if (retryCount < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                return getJson(apiUrl, action, query, retryCount + 1);
            }
            return { success: false, message: 'Сетевая ошибка при запросе к серверу: ' + (error.message || 'Unknown error') };
        }
    };

    const getCurrentUser = () => {
        try {
            return JSON.parse(localStorage.getItem('tobebe_user') || 'null');
        } catch {
            return null;
        }
    };

    const createIncomingOverlay = (call, handlers) => {
        let root = document.getElementById('incomingCallOverlay');
        if (root) root.remove();
        root = document.createElement('div');
        root.id = 'incomingCallOverlay';
        root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,10,14,0.78);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(8px);';
        const card = document.createElement('div');
        card.style.cssText = 'width:min(360px,100%);background:#171a20;border:1px solid rgba(255,255,255,0.16);border-radius:18px;padding:18px;color:#fff;text-align:center;box-shadow:0 18px 40px rgba(0,0,0,0.45);';
        const typeText = call.call_type === 'video' ? 'Видеозвонок' : 'Голосовой звонок';
        
        let callerName = `Пользователь #${escapeHtml(call.caller_id)}`;
        if (call.caller_display_name) {
            callerName = escapeHtml(call.caller_display_name);
        } else if (call.caller_username) {
            callerName = `@${escapeHtml(call.caller_username)}`;
        }
        
        card.innerHTML = `
            <div style="font-size:18px;font-weight:700;margin-bottom:8px;">Входящий звонок</div>
            <div style="font-size:14px;opacity:.9;margin-bottom:4px;">${escapeHtml(typeText)}</div>
            <div style="font-size:13px;color:#b7bfd0;margin-bottom:16px;">${callerName}</div>
            <div style="display:flex;gap:10px;">
                <button id="incomingDeclineBtn" style="flex:1;height:42px;border-radius:999px;border:1px solid rgba(255,255,255,0.2);background:#2a2e37;color:#fff;font-weight:600;cursor:pointer;transition:all 0.2s ease;">Отклонить</button>
                <button id="incomingAcceptBtn" style="flex:1;height:42px;border-radius:999px;border:1px solid rgba(255,255,255,0.2);background:#580005;color:#fff;font-weight:600;cursor:pointer;transition:all 0.2s ease;">Ответить</button>
            </div>
        `;
        root.appendChild(card);
        document.body.appendChild(root);
        
        const declineBtn = card.querySelector('#incomingDeclineBtn');
        const acceptBtn = card.querySelector('#incomingAcceptBtn');
        
        declineBtn?.addEventListener('click', () => {
            declineBtn.style.transform = 'scale(0.97)';
            setTimeout(() => { declineBtn.style.transform = ''; }, 150);
            handlers.onDecline();
        });
        
        acceptBtn?.addEventListener('click', () => {
            acceptBtn.style.transform = 'scale(0.97)';
            setTimeout(() => { acceptBtn.style.transform = ''; }, 150);
            handlers.onAccept();
        });
    };

    const notifierState = {
        timer: null,
        showingCallId: null,
        dismissed: new Set()
    };

    let callAudio = null;
    const playCallSound = () => {
        try {
            if (callAudio) {
                callAudio.pause();
                callAudio = null;
            }
            
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.value = 440;
            gainNode.gain.value = 0.3;
            
            oscillator.start();
            
            let isPlaying = true;
            const interval = setInterval(() => {
                if (!isPlaying) {
                    clearInterval(interval);
                    return;
                }
                gainNode.gain.value = gainNode.gain.value === 0.3 ? 0 : 0.3;
            }, 500);
            
            setTimeout(() => {
                if (oscillator) {
                    try {
                        oscillator.stop();
                        audioContext.close();
                    } catch(e) {}
                }
                clearInterval(interval);
                isPlaying = false;
            }, 30000);
            
            callAudio = { oscillator, audioContext, interval };
        } catch (e) {
            console.warn('Could not play call sound:', e);
        }
    };
    
    const stopCallSound = () => {
        if (callAudio) {
            try {
                if (callAudio.oscillator) callAudio.oscillator.stop();
                if (callAudio.audioContext) callAudio.audioContext.close();
                if (callAudio.interval) clearInterval(callAudio.interval);
            } catch(e) {}
            callAudio = null;
        }
    };

    window.TobebeCallsApi = {
        async initiateCall({ apiUrl = defaultApiUrl, callerId, calleeId, callType, callerPeerId }) {
            if (!callerId || !calleeId) {
                return { success: false, message: 'Не указаны участники звонка' };
            }
            return postJson(apiUrl, 'initiate_call', {
                caller_id: callerId,
                callee_id: calleeId,
                call_type: callType,
                caller_peer_id: callerPeerId
            });
        },
        
        async getCallState({ apiUrl = defaultApiUrl, userId, callId }) {
            if (!userId || !callId) {
                return { success: false, message: 'Недостаточно данных' };
            }
            return getJson(apiUrl, 'get_call_state', { user_id: userId, call_id: callId });
        },
        
        async acceptCall({ apiUrl = defaultApiUrl, userId, callId, calleePeerId }) {
            if (!userId || !callId || !calleePeerId) {
                return { success: false, message: 'Недостаточно данных для принятия звонка' };
            }
            return postJson(apiUrl, 'accept_call', {
                user_id: userId,
                call_id: callId,
                callee_peer_id: calleePeerId
            });
        },
        
        async declineCall({ apiUrl = defaultApiUrl, userId, callId }) {
            if (!userId || !callId) {
                return { success: false, message: 'Недостаточно данных' };
            }
            return postJson(apiUrl, 'decline_call', { user_id: userId, call_id: callId });
        },
        
        async cancelCall({ apiUrl = defaultApiUrl, userId, callId }) {
            if (!userId || !callId) {
                return { success: false, message: 'Недостаточно данных' };
            }
            return postJson(apiUrl, 'cancel_call', { user_id: userId, call_id: callId });
        },
        
        async endCall({ apiUrl = defaultApiUrl, userId, callId }) {
            if (!userId || !callId) {
                return { success: false, message: 'Недостаточно данных' };
            }
            return postJson(apiUrl, 'end_call', { user_id: userId, call_id: callId });
        },
        
        async heartbeat({ apiUrl = defaultApiUrl, userId, callId }) {
            if (!userId || !callId) {
                return { success: false, message: 'Недостаточно данных' };
            }
            try {
                return await postJson(apiUrl, 'call_heartbeat', { user_id: userId, call_id: callId });
            } catch (error) {
                console.error('Heartbeat failed:', error);
                return { success: false, message: 'Heartbeat error: ' + (error.message || 'Unknown') };
            }
        },
        
        async pollIncoming({ apiUrl = defaultApiUrl, userId }) {
            if (!userId) {
                return { success: false, message: 'Нет ID пользователя', incoming_call: null };
            }
            try {
                return await getJson(apiUrl, 'poll_calls', { user_id: userId });
            } catch (error) {
                console.error('Poll incoming error:', error);
                return { success: false, message: 'Poll error', incoming_call: null };
            }
        },
        
        async getCallerInfo({ apiUrl = defaultApiUrl, userId, callerId }) {
            if (!userId || !callerId) {
                return { success: false, message: 'Недостаточно данных' };
            }
            return getJson(apiUrl, 'get_user_by_id', { user_id: userId, target_user_id: callerId });
        }
    };

    window.TobebeCallNotifier = {
        init(config = {}) {
            const apiUrl = config.apiUrl || defaultApiUrl;
            const getCurrentUserId = typeof config.getCurrentUserId === 'function'
                ? config.getCurrentUserId
                : () => getCurrentUser()?.id || null;
            const onAccept = typeof config.onAccept === 'function' ? config.onAccept : () => {};
            const toast = typeof config.toast === 'function' ? config.toast : () => {};

            if (notifierState.timer) clearInterval(notifierState.timer);
            
            let isProcessingCall = false;
            
            const tick = async () => {
                if (isProcessingCall) return;
                
                const userId = Number(getCurrentUserId() || 0);
                if (!userId) return;
                
                try {
                    isProcessingCall = true;
                    const data = await window.TobebeCallsApi.pollIncoming({ apiUrl, userId });
                    const incoming = data?.incoming_call || null;
                    
                    if (incoming && incoming.expires_at) {
                        const expiresAt = new Date(incoming.expires_at);
                        if (expiresAt < new Date()) {
                            if (notifierState.showingCallId === String(incoming.id)) {
                                document.getElementById('incomingCallOverlay')?.remove();
                                notifierState.showingCallId = null;
                                stopCallSound();
                            }
                            isProcessingCall = false;
                            return;
                        }
                    }
                    
                    if (!incoming || !incoming.id || notifierState.dismissed.has(String(incoming.id))) {
                        if (notifierState.showingCallId && (!incoming || String(incoming.id) !== notifierState.showingCallId)) {
                            document.getElementById('incomingCallOverlay')?.remove();
                            notifierState.showingCallId = null;
                            stopCallSound();
                        }
                        isProcessingCall = false;
                        return;
                    }
                    
                    if (notifierState.showingCallId === String(incoming.id)) {
                        isProcessingCall = false;
                        return;
                    }
                    
                    let callerInfo = null;
                    try {
                        const callerData = await window.TobebeCallsApi.getCallerInfo({ apiUrl, userId, callerId: incoming.caller_id });
                        if (callerData.success && callerData.user) {
                            callerInfo = callerData.user;
                            incoming.caller_display_name = callerInfo.display_name;
                            incoming.caller_username = callerInfo.username;
                        }
                    } catch (e) {
                        console.warn('Could not fetch caller info:', e);
                    }
                    
                    notifierState.showingCallId = String(incoming.id);
                    
                    playCallSound();
                    
                    createIncomingOverlay(incoming, {
                        onDecline: async () => {
                            stopCallSound();
                            notifierState.dismissed.add(String(incoming.id));
                            document.getElementById('incomingCallOverlay')?.remove();
                            notifierState.showingCallId = null;
                            const result = await window.TobebeCallsApi.declineCall({ apiUrl, userId, callId: incoming.id });
                            if (result.success) {
                                toast('Звонок отклонен');
                            } else {
                                toast('Ошибка при отклонении звонка');
                            }
                        },
                        onAccept: () => {
                            stopCallSound();
                            document.getElementById('incomingCallOverlay')?.remove();
                            notifierState.showingCallId = null;
                            onAccept(incoming);
                        }
                    });
                    
                    if (document.hidden && 'Notification' in window) {
                        if (Notification.permission === 'granted') {
                            const label = incoming.call_type === 'video' ? 'Видеозвонок' : 'Голосовой звонок';
                            const callerName = callerInfo?.display_name || callerInfo?.username || `Пользователь #${incoming.caller_id}`;
                            new Notification('Tobebe', { 
                                body: `${label} от ${escapeHtml(callerName)}`,
                                icon: callerInfo?.avatar || '/favicon-96x96.png',
                                tag: `call_${incoming.id}`,
                                requireInteraction: true
                            });
                        } else if (Notification.permission === 'default') {
                            Notification.requestPermission().catch(() => {});
                        }
                    }
                    
                    if (navigator.vibrate) {
                        navigator.vibrate([200, 100, 200]);
                    }
                    
                } catch (err) {
                    console.error('Poll incoming error:', err);
                } finally {
                    isProcessingCall = false;
                }
            };

            tick();
            notifierState.timer = setInterval(tick, 2000);
        },
        
        stop() {
            if (notifierState.timer) clearInterval(notifierState.timer);
            notifierState.timer = null;
            notifierState.showingCallId = null;
            notifierState.dismissed.clear();
            document.getElementById('incomingCallOverlay')?.remove();
            stopCallSound();
        },
        
        async checkNow(config = {}) {
            const apiUrl = config.apiUrl || defaultApiUrl;
            const getCurrentUserId = typeof config.getCurrentUserId === 'function'
                ? config.getCurrentUserId
                : () => getCurrentUser()?.id || null;
            const onAccept = typeof config.onAccept === 'function' ? config.onAccept : () => {};
            const toast = typeof config.toast === 'function' ? config.toast : () => {};
            
            const userId = Number(getCurrentUserId() || 0);
            if (!userId) return null;
            
            try {
                const data = await window.TobebeCallsApi.pollIncoming({ apiUrl, userId });
                const incoming = data?.incoming_call || null;
                
                if (incoming && incoming.id && !notifierState.dismissed.has(String(incoming.id))) {
                    if (notifierState.showingCallId !== String(incoming.id)) {
                        notifierState.showingCallId = String(incoming.id);
                        
                        let callerInfo = null;
                        try {
                            const callerData = await window.TobebeCallsApi.getCallerInfo({ apiUrl, userId, callerId: incoming.caller_id });
                            if (callerData.success && callerData.user) {
                                callerInfo = callerData.user;
                                incoming.caller_display_name = callerInfo.display_name;
                                incoming.caller_username = callerInfo.username;
                            }
                        } catch (e) {}
                        
                        createIncomingOverlay(incoming, {
                            onDecline: async () => {
                                notifierState.dismissed.add(String(incoming.id));
                                document.getElementById('incomingCallOverlay')?.remove();
                                notifierState.showingCallId = null;
                                await window.TobebeCallsApi.declineCall({ apiUrl, userId, callId: incoming.id });
                                toast('Звонок отклонен');
                            },
                            onAccept: () => {
                                document.getElementById('incomingCallOverlay')?.remove();
                                notifierState.showingCallId = null;
                                onAccept(incoming);
                            }
                        });
                    }
                    return incoming;
                }
                return null;
            } catch (err) {
                console.error('Check now error:', err);
                return null;
            }
        }
    };
})();
