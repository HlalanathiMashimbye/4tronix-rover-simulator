/*
 * CameraClient: the one WebSocket client for the satellite's camera stream.
 *
 * It lived inline in monitor.html until the run station grew a live view of
 * its own; two copies of a reconnecting socket drift apart the first time one
 * gets a fix the other doesn't, so the class moved here and both pages load
 * it. A classic script rather than a module because both callers are classic
 * inline scripts that need it before they run.
 *
 * The pages differ only in how they show state, so the constructor takes an
 * onStatus callback instead of reaching for the monitor's element ids the way
 * the inline version did. States it reports:
 *   'connecting' | 'connected' | 'disconnected' | 'disabled'
 */
(function () {
    class CameraClient {
        constructor(canvas, opts) {
            opts = opts || {};
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.ws = null;
            this.reconnectAttempts = 0;
            this.reconnectInterval = 5000;
            this.maxReconnectDelay = 30000;
            this.onStatus = opts.onStatus || function () {};
        }

        connect(url) {
            // A reconnect timer scheduled before disable() will still fire;
            // this is where it gets stopped.
            if (this.disabled) return;
            if (url) this.url = url;
            this.onStatus('connecting', 'Connecting...');

            try {
                this.ws = new WebSocket(this.url);

                this.ws.onopen = () => {
                    this.reconnectAttempts = 0;
                    this.onStatus('connected', 'Connected');
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.ws.onclose = () => {
                    this.onStatus('disconnected', 'Disconnected');
                    this.handleReconnect();
                };

                this.ws.onerror = (error) => {
                    console.error('Camera WebSocket error:', error);
                };
            } catch (error) {
                console.error('Failed to connect to camera:', error);
                this.handleReconnect();
            }
        }

        handleMessage(data) {
            try {
                const message = JSON.parse(data);
                if (message.type === 'frame') {
                    this.displayFrame(message.data);
                }
            } catch (e) {
                console.error('Error parsing camera message:', e);
            }
        }

        displayFrame(frameData) {
            const img = new Image();
            img.onload = () => {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
            };
            img.src = 'data:image/jpeg;base64,' + frameData;
        }

        handleReconnect() {
            // Retry forever with capped backoff - the camera service may be
            // down for hours and must recover without a page reload.
            if (this.disabled) return;
            this.reconnectAttempts++;
            const delay = Math.min(
                this.reconnectInterval * this.reconnectAttempts,
                this.maxReconnectDelay
            );
            this.onStatus('disconnected', 'Reconnecting…');
            setTimeout(() => this.connect(), delay);
        }

        // Stand down permanently and hand the canvas to something else.
        // Used when the yard is running a fake rover: there is no camera to
        // connect to, so retrying forever would both fight the simulator for
        // the canvas and sit on "Reconnecting..." for good.
        disable() {
            this.disabled = true;
            if (this.ws) {
                this.ws.onclose = null;   // don't trigger the reconnect loop
                this.ws.onerror = null;
                try { this.ws.close(); } catch (e) { /* already closing */ }
                this.ws = null;
            }
            this.onStatus('disabled', '');
        }
    }

    window.CameraClient = CameraClient;
})();
