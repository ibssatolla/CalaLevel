import { showToast } from './utils.js';

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
let watchId = null;
let isNavigating = false;
let currentDestination = null;
let routingControl = null;
let hasCenteredOnUser = false;
let isTrackingMode = false;

// DOM Elements
let parkCard;
let navControls;
let navEta;

export function invalidateMapSize() {
    if (map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

export function initMap() {
    parkCard = document.getElementById('park-details-card');
    navControls = document.getElementById('navigation-controls');
    navEta = document.getElementById('nav-eta');

    // Initialize Leaflet Map
    map = L.map('map-container');

    // CartoDB Dark Matter Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Render Markers
    renderMarkers();

    // Start Global Tracking
    startGlobalTracking();

    // Map Click closes card
    map.on('click', () => {
        if (parkCard) parkCard.classList.add('hidden');
    });

    // Initialize Event Listeners
    setupEventListeners();
}

function setupEventListeners() {
    // Filter Buttons
    const filterButtons = document.querySelectorAll('.filter-button');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
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
            showToast('Tracking Active', 'Camera locked to your location.');
            if (userLocation) {
                map.setView([userLocation.lat, userLocation.lng], 18, { animate: true });
            }
        });
    }

    if (btnCancel) {
        btnCancel.addEventListener('click', stopNavigation);
    }

    // View Map Button is handled by data-page="training" in HTML
}

function startGlobalTracking() {
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                userLocation = { lat, lng };

                // 1. Initial Auto-Zoom (Only once)
                if (!hasCenteredOnUser) {
                    map.setView([lat, lng], 12);
                    hasCenteredOnUser = true;

                    // Add "You are here" marker
                    L.circleMarker([lat, lng], {
                        radius: 8,
                        fillColor: '#3388ff',
                        color: '#fff',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).addTo(map).bindPopup("You are here");
                }

                // 2. Navigation Update (If active)
                if (isNavigating && currentDestination) {
                    updateNavigationState();

                    // Update Route Start Point
                    if (routingControl) {
                        const waypoints = routingControl.getWaypoints();
                        if (waypoints.length >= 2) {
                            waypoints[0].latLng = L.latLng(lat, lng);
                            routingControl.setWaypoints(waypoints);
                        }
                    }
                }
            },
            (error) => {
                console.warn('Location access denied or error:', error);
                if (!hasCenteredOnUser) {
                    fitAllMarkers(); // Fallback
                }
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            }
        );
    } else {
        fitAllMarkers();
    }
}

function fitAllMarkers() {
    if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds(), { padding: [50, 50] });
    } else {
        map.setView([65.0, 13.0], 5);
    }
}

function createCustomIcon(difficulty) {
    let color = 'var(--primary)';
    if (difficulty === 'Beginner') color = '#00ff88';
    if (difficulty === 'Intermediate') color = '#00f2ff';
    if (difficulty === 'Advanced') color = '#ff0055';
    if (difficulty === 'Elite') color = '#7000ff';

    return L.divIcon({
        className: 'custom-pin',
        html: `
            <div class="pin-marker">
                <div class="pin-pulse" style="background: ${color}"></div>
                <span class="pin-icon" style="filter: drop-shadow(0 0 5px ${color})">📍</span>
            </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
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
    diffTag.className = 'tag';
    if (park.difficulty === 'Beginner') diffTag.classList.add('tag-green');
    if (park.difficulty === 'Intermediate') diffTag.classList.add('tag-blue');
    if (park.difficulty === 'Advanced') diffTag.classList.add('tag-red');
    if (park.difficulty === 'Elite') diffTag.classList.add('tag-purple');

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

function startGPSTracking(destLat, destLng) {
    if (parkCard) parkCard.classList.add('hidden');

    if (!userLocation) {
        showToast('GPS Error', 'Waiting for location...');
        return;
    }

    if (navControls) navControls.classList.remove('hidden');

    isNavigating = true;
    isTrackingMode = false;
    currentDestination = { lat: destLat, lng: destLng };

    showToast('Navigation Started', 'Calculating route...');

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

function stopNavigation() {
    isNavigating = false;
    isTrackingMode = false;
    currentDestination = null;

    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }

    if (navControls) navControls.classList.add('hidden');

    fitAllMarkers();
    showToast('Navigation Cancelled', 'Route cleared.');
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
        showToast('Arrived!', 'You have reached the park.');
        stopNavigation();
    }
}
