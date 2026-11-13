import { showToast, confirmDialog } from './utils.js';
import { navigate } from './router.js';
import { isDemo } from './state.js';
import { icon } from './icons.js';

const parksData = [
    // Oslo
    { id: 1, name: 'Tufteparken Voldsløkka', lat: 59.939, lng: 10.758, difficulty: 'Intermediate', status: 'Active', desc: 'Popular park with good bars and dip station.', type: 'unclaimed', city: 'Oslo' },
    { id: 2, name: 'St. Hanshaugen Bars', lat: 59.927, lng: 10.740, difficulty: 'Beginner', status: 'Quiet', desc: 'Scenic spot with basic pull-up bars.', type: 'claimed', city: 'Oslo' },
    { id: 3, name: 'Sognsvann Calisthenics', lat: 59.963, lng: 10.733, difficulty: 'Advanced', status: 'Hotspot', desc: 'Full competition setup near the lake.', type: 'my-team', city: 'Oslo' },
    { id: 4, name: 'Aker Brygge Street Workout', lat: 59.911, lng: 10.723, difficulty: 'Elite', status: 'Event', desc: 'Urban setting, high traffic, muscle-up focus.', type: 'unclaimed', city: 'Oslo' },
    { id: 11, name: 'Tøyen Parkour Park', lat: 59.915, lng: 10.778, difficulty: 'Intermediate', status: 'Active', desc: 'Great for freestyle and parkour.', type: 'unclaimed', city: 'Oslo' },
    { id: 12, name: 'Frogner Park Bars', lat: 59.926, lng: 10.703, difficulty: 'Beginner', status: 'Busy', desc: 'Located inside the famous sculpture park.', type: 'claimed', city: 'Oslo' },

    // Bergen
    { id: 5, name: 'Nordnes Park', lat: 60.398, lng: 5.306, difficulty: 'Intermediate', status: 'Active', desc: 'Beautiful park by the sea.', type: 'unclaimed', city: 'Bergen' },
    { id: 6, name: 'Fjellveien Workout', lat: 60.400, lng: 5.340, difficulty: 'Advanced', status: 'Quiet', desc: 'Mountain view bars.', type: 'claimed', city: 'Bergen' },
    { id: 13, name: 'Skansemyren Idrettsplass', lat: 60.392, lng: 5.342, difficulty: 'Elite', status: 'Active', desc: 'Professional track and field setup with bars.', type: 'my-team', city: 'Bergen' },
    { id: 14, name: 'Mount Ulriken Top', lat: 60.377, lng: 5.381, difficulty: 'Advanced', status: 'Cold', desc: 'Highest workout spot in the city.', type: 'unclaimed', city: 'Bergen' },

    // Trondheim
    { id: 7, name: 'Marinen Park', lat: 63.426, lng: 10.396, difficulty: 'Beginner', status: 'Hotspot', desc: 'Student favorite near Nidarosdomen.', type: 'my-team', city: 'Trondheim' },
    { id: 15, name: 'Finalebanen Gym', lat: 63.419, lng: 10.392, difficulty: 'Intermediate', status: 'Active', desc: 'Central location near the hospital.', type: 'claimed', city: 'Trondheim' },
    { id: 16, name: 'Ladeparken', lat: 63.443, lng: 10.435, difficulty: 'Beginner', status: 'Family', desc: 'Large park with basic equipment.', type: 'unclaimed', city: 'Trondheim' },
    { id: 17, name: 'Ilaparken', lat: 63.430, lng: 10.375, difficulty: 'Intermediate', status: 'Quiet', desc: 'Nice neighborhood park.', type: 'unclaimed', city: 'Trondheim' },

    // Stavanger
    { id: 8, name: 'Mosvatnet Gym', lat: 58.956, lng: 5.716, difficulty: 'Intermediate', status: 'Active', desc: 'Lakeside training spot.', type: 'unclaimed', city: 'Stavanger' },
    { id: 18, name: 'Møllebukta Treningspark', lat: 58.943, lng: 5.655, difficulty: 'Advanced', status: 'Windy', desc: 'Right by the Three Swords monument.', type: 'claimed', city: 'Stavanger' },
    { id: 19, name: 'Tufteparken Madla', lat: 58.950, lng: 5.680, difficulty: 'Beginner', status: 'Active', desc: 'Good for beginners.', type: 'unclaimed', city: 'Stavanger' },
    { id: 20, name: 'Sørmarka Arena', lat: 58.930, lng: 5.730, difficulty: 'Elite', status: 'Indoor/Outdoor', desc: 'Competition grade equipment.', type: 'my-team', city: 'Stavanger' },

    // Tromsø
    { id: 9, name: 'Telegrafbukta', lat: 69.633, lng: 18.916, difficulty: 'Elite', status: 'Cold', desc: 'Arctic training under the northern lights.', type: 'unclaimed', city: 'Tromsø' },
    { id: 21, name: 'Charlottenlund Park', lat: 69.655, lng: 18.935, difficulty: 'Intermediate', status: 'Snowy', desc: 'Popular winter training spot.', type: 'claimed', city: 'Tromsø' },
    { id: 22, name: 'Strandvegen Fitness', lat: 69.620, lng: 18.950, difficulty: 'Beginner', status: 'Quiet', desc: 'Simple bars by the road.', type: 'unclaimed', city: 'Tromsø' },

    // Kristiansand
    { id: 10, name: 'Bystranda Bars', lat: 58.146, lng: 7.996, difficulty: 'Beginner', status: 'Sunny', desc: 'Beach workout setup.', type: 'claimed', city: 'Kristiansand' },
    { id: 23, name: 'Gimlemoen Campus', lat: 58.160, lng: 8.000, difficulty: 'Advanced', status: 'Active', desc: 'University campus park.', type: 'my-team', city: 'Kristiansand' },
    { id: 24, name: 'Ravnedalen', lat: 58.155, lng: 7.980, difficulty: 'Intermediate', status: 'Scenic', desc: 'Beautiful nature park.', type: 'unclaimed', city: 'Kristiansand' }
];

let map;
let markers = [];
let currentFilter = 'all';

// Global Geolocation State
let userLocation = null;
let watchId = null;            // non-null only while we are actually watching the position
let userMarker = null;
let watchHigh = false;
let pendingDestination = null; // set when "Navigate" was pressed before a fix existed
let resumeOnVisible = false;
let mapInView = false;
let isNavigating = false;
let currentDestination = null;
let routingControl = null;
let hasCenteredOnUser = false;
let isTrackingMode = false;

// DOM Elements
let parkCard;
let navControls;
let navEta;

export function initMap() {
    parkCard = document.getElementById('park-details-card');
    navControls = document.getElementById('navigation-controls');
    navEta = document.getElementById('nav-eta');

    // Leaflet comes from a CDN. If it did not load, say so instead of throwing and breaking the rest of the app.
    if (typeof L === 'undefined') {
        const box = document.getElementById('map-container');
        document.getElementById('map-skeleton')?.remove();
        if (box) box.innerHTML = '<p class="map-error">The map could not be loaded. Check your connection and reload the page.</p>';
        return;
    }

    // Initialize Leaflet Map
    map = L.map('map-container');

    // CartoDB Dark Matter Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    map.whenReady(() => document.getElementById('map-skeleton')?.remove());

    // Render Markers, and show them all until the user's location is known
    renderMarkers();
    fitAllMarkers();

    // Keep tiles correct when the layout changes (rotation, resize, mobile browser bars)
    window.addEventListener('resize', () => map.invalidateSize());
    window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 250));

    // Location is never requested here. It starts only when the user presses "Use my location" or "Navigate".
    setupLocationUi();

    // Map Click closes card
    map.on('click', () => {
        if (parkCard) parkCard.classList.add('hidden');
    });

    // Initialize Event Listeners
    setupEventListeners();
    applyDataMode();
}

// Ownership and activity are simulated. Real accounts only see the plain park list.
function applyDataMode() {
    const demo = isDemo();
    document.querySelectorAll('.map-filters .chip[data-filter]').forEach(chip => {
        const simulated = chip.dataset.filter !== 'all';
        chip.classList.toggle('hidden', simulated && !demo);
    });
    document.querySelector('.map-filters')?.classList.toggle('hidden', !demo);
    document.getElementById('park-status')?.classList.toggle('hidden', !demo);
    const note = document.querySelector('#map-note span');
    if (note) note.textContent = demo
        ? 'Demo data: park ownership, teams and activity are simulated. Locations are sample data.'
        : 'Park names, places and details are sample data and are not verified.';
}

function setupEventListeners() {
    // Filter Buttons
    const filterButtons = document.querySelectorAll('.map-filters .chip[data-filter]');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            currentFilter = btn.getAttribute('data-filter');
            renderMarkers();
        });
    });

    // Close Card Button
    const closeCardBtn = document.getElementById('close-card');
    if (closeCardBtn) {
        closeCardBtn.addEventListener('click', () => {
            if (parkCard) parkCard.classList.add('hidden');
        });
    }

    // Navigation Buttons
    const btnContinue = document.getElementById('btn-continue-route');
    const btnCancel = document.getElementById('btn-cancel-route');

    if (btnContinue) {
        btnContinue.addEventListener('click', () => {
            isTrackingMode = true;
            showToast('Following you', 'The map stays centred on your location.', { icon: 'navigation' });
            if (userLocation) {
                map.setView([userLocation.lat, userLocation.lng], 18, { animate: true });
            }
        });
    }

    if (btnCancel) {
        btnCancel.addEventListener('click', () => stopNavigation());
    }

    // "Train here" opens the Train screen
    const trainBtn = document.getElementById('park-train-btn');
    if (trainBtn) {
        trainBtn.addEventListener('click', () => {
            if (parkCard) parkCard.classList.add('hidden');
            navigate('train');
        });
    }
}

// ---- Location (opt-in) ----

const locateBtn = () => document.getElementById('locate-btn');
const locateStatus = () => document.getElementById('locate-status');

function setStatus(text, warn = false) {
    const el = locateStatus();
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('warn', warn);
}

function renderLocateButton() {
    const btn = locateBtn();
    if (!btn) return;
    const on = watchId !== null;
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('span').textContent = on ? 'Stop tracking' : 'Use my location';
}

function onPosition(position) {
    const { latitude: lat, longitude: lng } = position.coords;
    userLocation = { lat, lng };

    if (!userMarker) {
        userMarker = L.circleMarker([lat, lng], { radius: 8, fillColor: '#3388ff', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8 })
            .addTo(map).bindPopup('You are here');
    } else {
        userMarker.setLatLng([lat, lng]);
    }
    if (!hasCenteredOnUser) {
        map.setView([lat, lng], 12);
        hasCenteredOnUser = true;
    }
    setStatus(isNavigating ? 'Navigating. Location is on.' : 'Tracking your location.');

    if (pendingDestination) {
        const dest = pendingDestination;
        pendingDestination = null;
        beginNavigation(dest.lat, dest.lng);
        return;
    }
    if (isNavigating && currentDestination) {
        updateNavigationState();
        if (routingControl) {
            const waypoints = routingControl.getWaypoints();
            if (waypoints.length >= 2) {
                waypoints[0].latLng = L.latLng(lat, lng);
                routingControl.setWaypoints(waypoints);
            }
        }
    }
}

function onPositionError(error) {
    stopTracking({ silent: true });
    if (error.code === 1) {
        setStatus('Location is blocked. The map still works without it.', true);
        showToast('Location blocked', 'Allow location for this site in your browser settings if you want to use it.', { icon: 'shield', tone: 'gold' });
    } else if (error.code === 2) {
        setStatus('Your position is not available right now.', true);
        showToast('No position found', 'Check that location is on for your device, then try again.', { icon: 'navigation', tone: 'gold' });
    } else {
        setStatus('Finding your position took too long. Try again.', true);
        showToast('Location timed out', 'Move to an open area and try again.', { icon: 'timer', tone: 'gold' });
    }
}

// Low accuracy is enough to centre the map. High accuracy is only used while navigating a route.
function beginWatch(highAccuracy) {
    if (!navigator.geolocation) {
        setStatus('This browser does not support location.', true);
        return false;
    }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchHigh = highAccuracy;
    setStatus('Finding your position...');
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
        enableHighAccuracy: highAccuracy,
        maximumAge: highAccuracy ? 2000 : 15000,
        timeout: 15000
    });
    renderLocateButton();
    return true;
}

export function stopTracking({ silent = false } = {}) {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    pendingDestination = null;
    resumeOnVisible = false;
    if (isNavigating) stopNavigation({ silent: true });
    if (userMarker && map) { map.removeLayer(userMarker); }
    userMarker = null;
    userLocation = null;
    hasCenteredOnUser = false;
    renderLocateButton();
    if (!silent) {
        setStatus('Location is off.');
        showToast('Tracking stopped', 'Your location is no longer used.', { icon: 'shield', tone: 'success' });
    }
}

let consented = false; // asked once per page load

async function startTracking({ highAccuracy = false } = {}) {
    if (!consented) {
        consented = await confirmDialog({
            title: 'Use your location?',
            message: 'CalaLevel uses your position to centre the map on you and to draw a route to a park. It stays in your browser and is not sent to us. It is used only while this map is open, and you can stop it at any time.',
            confirmLabel: 'Allow'
        });
        if (!consented) return false;
    }
    return beginWatch(highAccuracy);
}

function setupLocationUi() {
    renderLocateButton();
    locateBtn()?.addEventListener('click', () => {
        if (watchId !== null) stopTracking();
        else startTracking();
    });

    // No background tracking: stop when the map leaves the screen (unless a route is active) and when the tab is hidden.
    const wrap = document.querySelector('.map-wrap');
    if ('IntersectionObserver' in window && wrap) {
        new IntersectionObserver(entries => {
            mapInView = entries[0].isIntersecting;
            if (!mapInView && watchId !== null && !isNavigating) {
                stopTracking({ silent: true });
                setStatus('Tracking stopped because you left the map.');
            }
        }, { threshold: 0 }).observe(wrap);
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
                resumeOnVisible = isNavigating || !!pendingDestination;
                if (!resumeOnVisible) { stopTracking({ silent: true }); setStatus('Tracking stopped while the page was hidden.'); }
                renderLocateButton();
            }
        } else if (resumeOnVisible) {
            resumeOnVisible = false;
            beginWatch(isNavigating);
        }
    });
    window.addEventListener('pagehide', () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); });
}

function fitAllMarkers() {
    if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds(), { padding: [50, 50] });
    } else {
        map.setView([65.0, 13.0], 5);
    }
}

function createCustomIcon(difficulty) {
    const colors = { Beginner: '#4ade80', Intermediate: '#22e1ee', Advanced: '#ff6b81', Elite: '#b9a2ff' };
    const color = colors[difficulty] || '#22e1ee';
    return L.divIcon({
        className: 'custom-pin',
        html: `<div class="pin" style="--pin:${color}"><span class="pin-pulse"></span>${icon('pin', { size: 34 })}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 38]
    });
}

function renderMarkers() {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    parksData.forEach(park => {
        if (currentFilter !== 'all') {
            if (currentFilter === 'claimed' && park.type !== 'claimed') return;
            if (currentFilter === 'unclaimed' && park.type !== 'unclaimed') return;
            if (currentFilter === 'my-team' && park.type !== 'my-team') return;
        }

        const marker = L.marker([park.lat, park.lng], {
            icon: createCustomIcon(park.difficulty)
        }).addTo(map);

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            showParkDetails(park);
            map.setView([park.lat, park.lng], 14, { animate: true });
        });

        markers.push(marker);
    });
}

function showParkDetails(park) {
    if (!parkCard) return;

    document.getElementById('park-name').textContent = park.name;
    document.getElementById('park-desc').textContent = park.desc;
    document.getElementById('park-difficulty').textContent = park.difficulty;
    document.getElementById('park-status').textContent = park.status;

    const diffTag = document.getElementById('park-difficulty');
    diffTag.className = `badge badge-${park.difficulty.toLowerCase()}`;

    parkCard.classList.remove('hidden');

    const navBtn = document.getElementById('navigate-btn');
    if (navBtn) {
        const newBtn = navBtn.cloneNode(true);
        navBtn.parentNode.replaceChild(newBtn, navBtn);

        newBtn.addEventListener('click', () => {
            startGPSTracking(park.lat, park.lng);
        });
    }
}

// "Navigate" from a park card. Asks for location first if it is not on yet.
async function startGPSTracking(destLat, destLng) {
    if (parkCard) parkCard.classList.add('hidden');
    if (!userLocation) {
        pendingDestination = { lat: destLat, lng: destLng };
        const started = await startTracking({ highAccuracy: true });
        if (!started) pendingDestination = null;
        return;
    }
    beginNavigation(destLat, destLng);
}

function beginNavigation(destLat, destLng) {
    if (watchId !== null && !watchHigh) beginWatch(true); // route needs a better fix than centring does
    if (navControls) navControls.classList.remove('hidden');

    isNavigating = true;
    isTrackingMode = false;
    currentDestination = { lat: destLat, lng: destLng };

    showToast('Route started', 'Calculating route...', { icon: 'navigation' });

    if (routingControl) {
        map.removeControl(routingControl);
    }

    routingControl = L.Routing.control({
        waypoints: [
            L.latLng(userLocation.lat, userLocation.lng),
            L.latLng(destLat, destLng)
        ],
        routeWhileDragging: false,
        showAlternatives: false,
        fitSelectedRoutes: true,
        lineOptions: {
            styles: [{ color: '#00f2fe', opacity: 0.8, weight: 6 }]
        },
        createMarker: function () { return null; },
        show: false
    }).addTo(map);

    routingControl.on('routesfound', function (e) {
        const routes = e.routes;
        if (routes && routes.length > 0) {
            const summary = routes[0].summary;
            const timeMin = Math.round(summary.totalTime / 60);
            if (navEta) navEta.textContent = `${timeMin} min`;
        }
    });
}

function stopNavigation({ silent = false } = {}) {
    const wasNavigating = isNavigating;
    isNavigating = false;
    isTrackingMode = false;
    currentDestination = null;

    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }

    if (navControls) navControls.classList.add('hidden');

    if (!silent) {
        if (wasNavigating && watchId !== null && watchHigh) beginWatch(false); // back to low accuracy
        fitAllMarkers();
        showToast('Route cleared', 'Navigation stopped. Location tracking is still on.', { icon: 'navigation' });
    }
}

function updateNavigationState() {
    if (!userLocation || !currentDestination) return;

    const { lat: userLat, lng: userLng } = userLocation;
    const { lat: destLat, lng: destLng } = currentDestination;

    if (isTrackingMode) {
        map.setView([userLat, userLng], 18, { animate: true });
    }

    const dist = Math.sqrt(Math.pow(userLat - destLat, 2) + Math.pow(userLng - destLng, 2));
    if (dist < 0.0005) { // Roughly 50m
        showToast('You have arrived', 'You have reached the park.', { icon: 'pin', tone: 'success' });
        stopNavigation();
    }
}
