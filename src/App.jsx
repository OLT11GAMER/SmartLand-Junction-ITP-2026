import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import {
  AlertTriangle,
  Compass,
  Database,
  Eye,
  Layers3,
  MapPinned,
  ShieldCheck,
  Sprout,
  Search,
  UserRound
} from 'lucide-react';
import {
  adminUser,
  detailedParcels,
  kosovoBounds,
  municipalityStats,
  regionalPointData
} from './data/landData';

const DETAIL_ZOOM = 11.5;
const EMPTY_COLLECTION = {
  type: 'FeatureCollection',
  features: []
};

const offlineTerrainStyle = {
  version: 8,
  layers: [
    {
      id: 'terrain-base',
      type: 'background',
      paint: {
        'background-color': '#18251f'
      }
    }
  ]
};

const formatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0
});

function parcelFeatureCollection(parcels, selectedId) {
  return {
    type: 'FeatureCollection',
    features: parcels.map((parcel) => ({
      type: 'Feature',
      geometry: parcel.geometry,
      properties: {
        id: parcel.id,
        owner: parcel.owner,
        municipality: parcel.municipality,
        currentCrop: parcel.currentCrop,
        color: parcel.color,
        status: parcel.status,
        selected: parcel.id === selectedId
      }
    }))
  };
}

function findParcel(parcelId) {
  return detailedParcels.find((parcel) => parcel.id === parcelId) || detailedParcels[0];
}

function StatusPill({ status }) {
  const styles = {
    Healthy: 'bg-[#e8f2e2] text-[#2f6d38] border-[#cfe2c9]',
    Watch: 'bg-[#fff2d7] text-[#8a6325] border-[#ead39b]',
    'Critical Alert': 'bg-[#fae7e4] text-[#a33a31] border-[#edc3bd]'
  };

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${styles[status]}`}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {status}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="border border-[#dbe4d5] bg-white/86 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-[#71806d]">{label}</div>
          <div className="mt-2 text-2xl font-extrabold text-[#17391f]">{value}</div>
        </div>
        <div className="grid h-10 w-10 place-items-center bg-[#eef5e9] text-[#3c7b45]">
          <Icon size={19} />
        </div>
      </div>
      <div className="mt-2 text-xs leading-5 text-[#667463]">{sub}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 border border-[#dbe4d5] bg-white/92 p-3 shadow-lg backdrop-blur">
      <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-[#667463]">Parcel status</div>
      {[
        ['#3c7b45', 'Healthy'],
        ['#d4a84f', 'Watch'],
        ['#c6473c', 'Critical Alert']
      ].map(([color, label]) => (
        <div key={label} className="flex items-center gap-2 py-1 text-xs font-semibold text-[#17391f]">
          <span className="h-3 w-3 border border-black/10" style={{ backgroundColor: color }} />
          {label}
        </div>
      ))}
    </div>
  );
}

function MapBadge({ label, value }) {
  return (
    <div className="border border-[#dbe4d5] bg-white/92 px-3 py-2 text-xs font-bold text-[#17391f] shadow-lg backdrop-blur">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-[#71806d]">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function renderTimeline(cropHistory) {
  return (
    <>
      <div className="timeline-bars">
        {cropHistory.map((point, index) => {
          const height = Math.max(8, Math.round((point.ndvi / 100) * 36));
          const color = point.ndvi >= 70 ? '#22c55e' : point.ndvi >= 40 ? '#f59e0b' : '#ef4444';
          return (
            <div
              key={`${point.month}-${index}`}
              className="tbar"
              style={{ height: `${height}px`, background: color, opacity: 0.58 + point.ndvi / 220 }}
              title={`${point.month}: ${point.ndvi}`}
            />
          );
        })}
      </div>
      <div className="tbar-label">
        <span>−24 muaj</span>
        <span>−12 muaj</span>
        <span>Sot</span>
      </div>
    </>
  );
}

function renderPulseBreakdown(parcel) {
  const historyStart = parcel.cropHistory?.[0]?.ndvi ?? parcel.landHealthScore;
  const historyEnd = parcel.cropHistory?.[parcel.cropHistory.length - 1]?.ndvi ?? parcel.landHealthScore;
  const trend = Math.max(0, Math.min(100, Math.round((historyStart - historyEnd + 100) / 2)));
  const factors = [
    { label: 'Shëndeti i tokës (40%)', val: parcel.landHealthScore },
    { label: 'Braktisja e parashikuar (30%)', val: Math.round((parcel.abandonmentProbability ?? 0) * 100) },
    { label: 'Risku i përputhshmërisë (20%)', val: parcel.complianceRisk ?? 0 },
    { label: 'Tendenca sezonale (10%)', val: trend }
  ];

  return factors.map((factor) => (
    <div key={factor.label} style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-mid)', marginBottom: '3px' }}>
        <span>{factor.label}</span>
        <span style={{ fontWeight: 700 }}>{factor.val}</span>
      </div>
      <div style={{ height: '5px', background: 'var(--stone-pale)', borderRadius: '3px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${factor.val}%`,
            background: factor.val >= 70 ? '#22c55e' : factor.val >= 40 ? '#f59e0b' : '#ef4444',
            borderRadius: '3px',
            transition: 'width 0.6s'
          }}
        />
      </div>
    </div>
  ));
}

function renderBlockchain(chain) {
  return chain.map((item) => (
    <div key={item.id} className="chain-item">
      <div className="chain-dot">{item.status === 'Healthy' ? '✓' : '⏳'}</div>
      <div className="chain-content">
        <div className="chain-action">{item.action}</div>
        <div className="chain-hash">🔗 {item.hash} ← {item.previousHash?.substring(0, 8)}…</div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '3px' }}>
          <span className="chain-time">{new Date(item.timestamp).toLocaleDateString('sq-AL', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <span className={`chain-badge ${item.status === 'Healthy' ? 'verified' : ''}`}>
            {item.status === 'Healthy' ? '✓ Verifikuar' : '⏳ Në pritje'}
          </span>
          <span className="chain-badge" style={{ background: 'var(--earth-pale)', color: 'var(--earth)' }}>
            {item.status}
          </span>
        </div>
      </div>
    </div>
  ));
}

function SatellitePanel({ parcel }) {
  const confidence = Math.max(18, Math.min(96, parcel.landHealthScore + 7));
  return (
    <div className="sat-section">
      <div className="ts-title">Krahasimi satelitor</div>
      <div className="sat-compare">
        <div className="sat-panel">
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(0,0,0,0.18)), radial-gradient(circle at 30% 20%, rgba(115, 168, 110, 0.26), transparent 38%), linear-gradient(180deg, #314d2d, #1f311f)'
            }}
          />
          <div className="sat-panel-label">Deklaruar nga fermeri</div>
        </div>
        <div className="sat-panel">
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(0,0,0,0.18)), radial-gradient(circle at 65% 35%, rgba(213, 181, 111, 0.26), transparent 36%), linear-gradient(180deg, #444f37, #20261f)'
            }}
          />
          <div className="sat-panel-label">Satelit / Ndërveprim</div>
        </div>
      </div>
      <div className="sat-confidence">
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-mid)' }}>Confidence</span>
        <div className="sat-conf-bar">
          <div className="sat-conf-fill" style={{ width: `${confidence}%` }} />
        </div>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-mid)' }}>{confidence}%</span>
      </div>
      <div className="sat-advisory">
        {parcel.advisory}
      </div>
    </div>
  );
}

function AdvisorPanel({ parcel, chatMessages, chatInput, setChatInput, sendChat }) {
  const prompts = ['Kur duhet mbjellja?', 'A ka mospërputhje satelitore?', 'Si e rris Land Pulse?', 'Subvencione?'];
  return (
    <div className="ai-section">
      <div className="ts-title">Këshilltari AI</div>
      <div className="chat-msgs">
        {chatMessages.map((msg, index) => (
          <div key={`${msg.role}-${index}`} className={`cmsg ${msg.role}`}>
            {msg.text}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            className="abtn"
            type="button"
            onClick={() => setChatInput(prompt)}
            style={{ flex: '1 1 calc(50% - 3px)', padding: '7px 8px' }}
          >
            {prompt}
          </button>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') sendChat();
          }}
          placeholder={`Pyet për parcelën ${parcel.id}…`}
        />
        <button type="button" className="chat-send" onClick={sendChat}>Dërgo</button>
      </div>
    </div>
  );
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const [selectedId, setSelectedId] = useState(detailedParcels[0]?.id ?? null);
  const [zoom, setZoom] = useState(8.2);
  const [mapReady, setMapReady] = useState(false);
  const [osmStatus, setOsmStatus] = useState('loading');
  const [osmCounts, setOsmCounts] = useState({ landuse: 0, adminareas: 0, water: 0 });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [activeDetailTab, setActiveDetailTab] = useState('overview');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const selectedParcel = useMemo(() => findParcel(selectedId), [selectedId]);
  const parcelData = useMemo(() => parcelFeatureCollection(detailedParcels, selectedId), [selectedId]);
  const isDetailView = zoom >= DETAIL_ZOOM;
  const stats = useMemo(() => municipalityStats(detailedParcels), []);
  const filteredParcels = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return detailedParcels.filter((parcel) => {
      const pulse = parcel.landHealthScore ?? parcel.farmScore ?? 0;
      if (filterMode === 'risk' && pulse >= 40) return false;
      if (filterMode === 'stress' && (pulse < 40 || pulse >= 70)) return false;
      if (filterMode === 'thriving' && pulse < 70) return false;
      if (!query) return true;
      return [
        parcel.id,
        parcel.owner,
        parcel.municipality,
        parcel.currentCrop,
        parcel.status
      ].some((field) => String(field).toLowerCase().includes(query));
    });
  }, [filterMode, searchTerm]);
  const filteredRegionalPoints = useMemo(() => {
    if (filterMode === 'all') return regionalPointData;
    const statusForMode = filterMode === 'risk'
      ? 'Critical Alert'
      : filterMode === 'stress'
        ? 'Watch'
        : 'Healthy';
    return {
      ...regionalPointData,
      features: regionalPointData.features.filter((feature) => feature?.properties?.status === statusForMode)
    };
  }, [filterMode]);
  const summary = useMemo(() => {
    const critical = detailedParcels.filter((parcel) => parcel.status === 'Critical Alert').length;
    const avgHealth = Math.round(detailedParcels.reduce((sum, parcel) => sum + parcel.landHealthScore, 0) / detailedParcels.length);
    const loss = detailedParcels.reduce((sum, parcel) => sum + parcel.projectedLoss, 0);
    return { critical, avgHealth, loss };
  }, []);

  useEffect(() => {
    setActiveDetailTab('overview');
    setChatMessages([
      {
        role: 'ai',
        text: `Mirëdita! Jam këshilltari juaj AI për parcelën ${selectedParcel.id}. Land Pulse aktual është ${selectedParcel.landHealthScore}/100. Si mund t'ju ndihmoj sot?`
      }
    ]);
  }, [selectedParcel.id]);

  const zoomIn = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();
  const resetMap = () => {
    mapRef.current?.fitBounds(kosovoBounds, { padding: 36, duration: 700 });
  };

  const sendChat = () => {
    const question = chatInput.trim();
    if (!question) return;
    const response = (() => {
      const q = question.toLowerCase();
      if (q.includes('mbjell')) {
        return `Për parcelën ${selectedParcel.id}, rekomandohet të verifikohet sezoni dhe lagështia para mbjelljes. Me Land Pulse ${selectedParcel.landHealthScore}/100, prioritet është mirëmbajtja e rregullt.`;
      }
      if (q.includes('pulse')) {
        return 'Për ta rritur Land Pulse, regjistroni aktivitetet sezonale, ulni ditët pa aktivitet dhe mbani përputhje me raportimin satelitor.';
      }
      if (q.includes('subvenc')) {
        return 'Kjo parcelë mund të jetë kandidate për subvencione nëse aktiviteti bujqësor dokumentohet rregullisht dhe nuk ka mospërputhje të mëdha satelitore.';
      }
      if (q.includes('satelit')) {
        return selectedParcel.status === 'Healthy'
          ? 'Të dhënat satelitore përputhen me raportimin e fermerit. Kjo e ul rrezikun administrativ.'
          : 'Ka mospërputhje satelitore. Rekomandohet inspektim ose kërkesë për përditësim nga fermeri.';
      }
      return `Bazuar në parcelën ${selectedParcel.id}, Land Pulse është ${selectedParcel.landHealthScore}/100 dhe rreziku i braktisjes është ${Math.round((selectedParcel.abandonmentProbability ?? 0) * 100)}%.`;
    })();

    setChatMessages((prev) => [
      ...prev,
      { role: 'user', text: question },
      { role: 'ai', text: response }
    ]);
    setChatInput('');
  };

  useEffect(() => {
    if (!mapContainerRef.current) return undefined;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: offlineTerrainStyle,
      center: [20.9, 42.58],
      zoom: 8.2,
      minZoom: 7.3,
      maxZoom: 16.8,
      maxBounds: kosovoBounds
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });

    const syncZoomState = () => {
      setZoom(Number(map.getZoom().toFixed(2)));
    };

    const showParcelPopup = (parcel) => {
      if (!parcel) return;

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 18
      })
        .setLngLat(parcel.centroid)
        .setHTML(
          `<div class="map-label">${parcel.id}</div><div class="map-sub">${parcel.municipality} · ${parcel.currentCrop}</div>`
        )
        .addTo(map);
    };

    const handleResize = () => {
      map.resize();
    };

    resizeObserver.observe(mapContainerRef.current);

    map.on('load', () => {
      map.addSource('osm-landuse', {
        type: 'geojson',
        data: EMPTY_COLLECTION
      });

      map.addSource('osm-adminareas', {
        type: 'geojson',
        data: EMPTY_COLLECTION
      });

      map.addSource('osm-water', {
        type: 'geojson',
        data: EMPTY_COLLECTION
      });

      map.addSource('regional-points', {
        type: 'geojson',
        data: filteredRegionalPoints
      });

      map.addSource('parcel-polygons', {
        type: 'geojson',
        data: parcelFeatureCollection(detailedParcels, selectedId)
      });

      map.addLayer({
        id: 'osm-landuse-fill',
        type: 'fill',
        source: 'osm-landuse',
        maxzoom: DETAIL_ZOOM,
        paint: {
          'fill-color': [
            'match',
            ['get', 'category'],
            'agriculture', '#b7d67d',
            'tree_crop', '#d9b56f',
            'woodland', '#5f844d',
            'open', '#d6df98',
            'built', '#ccb9a0',
            '#b7d67d'
          ],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.18, 10.5, 0.15, 11.4, 0.12]
        }
      });

      map.addLayer({
        id: 'osm-landuse-outline',
        type: 'line',
        source: 'osm-landuse',
        maxzoom: DETAIL_ZOOM,
        paint: {
          'line-color': [
            'match',
            ['get', 'category'],
            'agriculture', '#6c8e4d',
            'tree_crop', '#a97b2f',
            'woodland', '#355334',
            'open', '#9da86d',
            'built', '#948372',
            '#6c8e4d'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.35, 11.4, 0.9],
          'line-opacity': 0.34
        }
      });

      map.addLayer({
        id: 'osm-water-fill',
        type: 'fill',
        source: 'osm-water',
        maxzoom: DETAIL_ZOOM,
        paint: {
          'fill-color': '#78aede',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.18, 11.4, 0.11]
        }
      });

      map.addLayer({
        id: 'osm-water-outline',
        type: 'line',
        source: 'osm-water',
        maxzoom: DETAIL_ZOOM,
        paint: {
          'line-color': '#5b8fc2',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.3, 11.4, 0.7],
          'line-opacity': 0.45
        }
      });

      map.addLayer({
        id: 'osm-adminareas-line',
        type: 'line',
        source: 'osm-adminareas',
        maxzoom: DETAIL_ZOOM,
        paint: {
          'line-color': '#17391f',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.3, 11.4, 0.8],
          'line-opacity': 0.22,
          'line-dasharray': [2, 1.5]
        }
      });

      map.addLayer({
        id: 'regional-points-glow',
        type: 'circle',
        source: 'regional-points',
        maxzoom: DETAIL_ZOOM,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2, DETAIL_ZOOM, 16],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.22,
          'circle-blur': 0.9
        }
      });

      map.addLayer({
        id: 'regional-points',
        type: 'circle',
        source: 'regional-points',
        maxzoom: DETAIL_ZOOM,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.7, DETAIL_ZOOM, 8.5],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.9,
          'circle-stroke-width': 0.7,
          'circle-stroke-color': '#ffffff'
        }
      });

      map.addLayer({
        id: 'parcel-fills',
        type: 'fill',
        source: 'parcel-polygons',
        minzoom: DETAIL_ZOOM,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.34, 0.14]
        }
      });

      map.addLayer({
        id: 'parcel-lines',
        type: 'line',
        source: 'parcel-polygons',
        minzoom: DETAIL_ZOOM,
        paint: {
          'line-color': ['case', ['==', ['get', 'selected'], true], '#102816', '#f7f5ed'],
          'line-width': ['case', ['==', ['get', 'selected'], true], 3.6, 1.3],
          'line-opacity': 0.98
        }
      });

      map.on('click', 'regional-points', (event) => {
        const feature = event.features?.[0];
        const parcel = findParcel(feature?.properties?.detailId);
        if (!parcel) return;

        setSelectedId(parcel.id);
        map.flyTo({
          center: parcel.centroid,
          zoom: DETAIL_ZOOM + 1.8,
          speed: 0.8,
          curve: 1.2
        });
      });

      map.on('click', 'parcel-fills', (event) => {
        const feature = event.features?.[0];
        const parcel = findParcel(feature?.properties?.id);
        if (!parcel) return;

        setSelectedId(parcel.id);
        showParcelPopup(parcel);
      });

      ['regional-points', 'parcel-fills'].forEach((layerId) => {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = '';
        });
      });

      map.fitBounds(kosovoBounds, { padding: 36, duration: 0 });
      requestAnimationFrame(() => {
        map.resize();
      });
      syncZoomState();

      Promise.all([
        fetch('/data/kosovo-landuse.geojson').then((response) => response.json()),
        fetch('/data/kosovo-adminareas.geojson').then((response) => response.json()),
        fetch('/data/kosovo-water.geojson').then((response) => response.json())
      ])
        .then(([landuse, adminareas, water]) => {
          map.getSource('osm-landuse')?.setData(landuse);
          map.getSource('osm-adminareas')?.setData(adminareas);
          map.getSource('osm-water')?.setData(water);
          setOsmCounts({
            landuse: landuse.features?.length ?? 0,
            adminareas: adminareas.features?.length ?? 0,
            water: water.features?.length ?? 0
          });
          setOsmStatus('ready');
        })
        .catch(() => {
          setOsmStatus('unavailable');
        })
        .finally(() => {
          setMapReady(true);
        });
    });

    map.on('zoom', syncZoomState);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      popupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;

    const regionalSource = map.getSource('regional-points');
    if (regionalSource) {
      regionalSource.setData(filteredRegionalPoints);
    }

    const source = map.getSource('parcel-polygons');
    if (source) {
      source.setData(parcelData);
    }

    if (selectedParcel && isDetailView) {
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 18
      })
        .setLngLat(selectedParcel.centroid)
        .setHTML(
          `<div class="map-label">${selectedParcel.id}</div><div class="map-sub">${selectedParcel.municipality} · ${selectedParcel.currentCrop}</div>`
        )
        .addTo(map);
    } else {
      popupRef.current?.remove();
    }
  }, [filteredRegionalPoints, isDetailView, parcelData, selectedParcel]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-hex">
            <Sprout size={20} />
          </div>
          <div>
            <div className="brand-name">TOKA</div>
            <div className="brand-tag">Paneli Administrativ</div>
          </div>
        </div>

        <div className="topbar-center">
          <div className="topbar-search">
            <Search size={14} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Kërko parcelë, pronar, komunë…"
              id="global-search"
            />
          </div>
        </div>

        <button className="hamburger" type="button" onClick={() => setSidebarOpen((value) => !value)} aria-label="Menu">
          ☰
        </button>

        <div className="topbar-right">
          <div className="live-badge">
            <div className="live-dot" />
            <span>Live — Kosovë</span>
          </div>
          <div className="admin-chip">
            <div className="admin-av">GK</div>
            <span>{adminUser.name}</span>
          </div>
        </div>
      </header>

      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        role="presentation"
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <button className="sidebar-close" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close">
          ✕
        </button>

        <div className="sidebar-section">
          <div className="stat-grid">
            <div className="stat-card good">
              <div className="sv">{regionalPointData.features.length.toLocaleString('de-DE')}</div>
              <div className="sl">Visible parcel points</div>
            </div>
            <div className="stat-card good">
              <div className="sv">{summary.avgHealth}</div>
              <div className="sl">Average health</div>
            </div>
            <div className="stat-card danger">
              <div className="sv">{summary.critical}</div>
              <div className="sl">Compliance alerts</div>
            </div>
            <div className="stat-card warn">
              <div className="sv">{formatter.format(summary.loss)}</div>
              <div className="sl">Projected impact</div>
            </div>
          </div>
        </div>

        <div className="sidebar-section sidebar-insights-section">
          <div className="insights-panel" id="insights-panel">
            <div className="municipality-card active">
              <div className="card-top">
                <div>
                  <div className="brand-tag" style={{ color: 'rgba(255,255,255,0.4)' }}>Republika e Kosovës</div>
                  <h3>{selectedParcel.municipality}</h3>
                </div>
                <div className="score-box">{selectedParcel.landHealthScore}</div>
              </div>
              <div className={`risk-badge ${selectedParcel.status === 'Healthy' ? 'positive' : selectedParcel.status === 'Watch' ? 'medium' : 'negative'}`}>
                {selectedParcel.status}
              </div>
              <div className="card-content">
                <div className="info-row">
                  <span>Current crop</span>
                  <span className="positive">{selectedParcel.currentCrop}</span>
                </div>
                <div className="info-row">
                  <span>Owner</span>
                  <span>{selectedParcel.owner}</span>
                </div>
                <div className="info-row">
                  <span>Compliance risk</span>
                  <span className={selectedParcel.complianceRisk > 60 ? 'negative' : selectedParcel.complianceRisk > 35 ? 'warning' : 'positive'}>
                    {selectedParcel.complianceRisk}%
                  </span>
                </div>
                <div className="info-row">
                  <span>Projected loss</span>
                  <span>{formatter.format(selectedParcel.projectedLoss)}</span>
                </div>
                <div className="expanded-info">
                  <p>{selectedParcel.advisory}</p>
                  <div className="stats-grid">
                    <div>
                      <h4>{selectedParcel.hectares}</h4>
                      <span>hectares</span>
                    </div>
                    <div>
                      <h4>{Math.round((selectedParcel.abandonmentProbability ?? 0) * 100)}%</h4>
                      <span>abandonment</span>
                    </div>
                    <div>
                      <h4>{selectedParcel.monocultureYears}</h4>
                      <span>mono years</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="ins-card">
              <div className="ins-title">
                <MapPinned size={13} />
                Municipality insight
              </div>
              <table className="muni-table">
                <thead>
                  <tr>
                    <th>Municipality</th>
                    <th>Parcels</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.slice(0, 5).map((stat) => (
                    <tr key={stat.municipality}>
                      <td>{stat.municipality}</td>
                      <td>{stat.parcels}</td>
                      <td>
                        <div className="muni-risk-bar">
                          <div className="muni-risk-fill" style={{ width: `${stat.health}%`, background: stat.health >= 70 ? '#22c55e' : stat.health >= 40 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="ss-label">
            Parcela — <span id="parcel-count-label">{filteredParcels.length} Gjithsej</span>
          </div>
          <div className="parcel-list" id="parcel-list">
            {filteredParcels.slice(0, 40).map((parcel) => {
              const pulse = parcel.landHealthScore;
              const color = parcel.status === 'Healthy' ? '#22c55e' : parcel.status === 'Watch' ? '#f59e0b' : '#ef4444';
              return (
                <div
                  key={parcel.id}
                  className={`pitem ${selectedParcel.id === parcel.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedId(parcel.id);
                    setSidebarOpen(false);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setSelectedId(parcel.id);
                  }}
                >
                  <div className="pitem-pulse" style={{ background: color }}>
                    {pulse}
                  </div>
                  <div className="pitem-info">
                    <div className="pitem-name">{parcel.id}</div>
                    <div className="pitem-sub">{parcel.municipality} · {parcel.hectares} ha · {parcel.owner.split(' ')[0]}</div>
                  </div>
                  <div className="pitem-score" style={{ color }}>
                    {parcel.status === 'Healthy' ? 'Aktive' : parcel.status === 'Watch' ? 'Stres' : 'Rrezik'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="main">
        <section className="map-wrapper" id="map-wrapper">
          <div className="map-overlay-tl">
            <div className="map-badge">
              <Eye size={12} />
              Republika e Kosovës — Harta Kadastrale
            </div>
            <div className="map-badge" id="selected-muni-badge" style={{ display: 'flex' }}>
              📍 <span id="selected-muni-text">{selectedParcel.municipality}</span>
            </div>
          </div>

          <div className="map-filter">
            <div className={`tpill ${filterMode === 'all' ? 'active' : ''}`} onClick={() => setFilterMode('all')}>
              <span className="dot" style={{ background: '#64748b' }} />
              Të gjitha
            </div>
            <div className={`tpill ${filterMode === 'risk' ? 'active' : ''}`} onClick={() => setFilterMode('risk')}>
              <span className="dot" style={{ background: 'var(--pulse-red)' }} />
              Nën Rrezik
            </div>
            <div className={`tpill ${filterMode === 'stress' ? 'active' : ''}`} onClick={() => setFilterMode('stress')}>
              <span className="dot" style={{ background: 'var(--pulse-amber)' }} />
              Në Stres
            </div>
            <div className={`tpill ${filterMode === 'thriving' ? 'active' : ''}`} onClick={() => setFilterMode('thriving')}>
              <span className="dot" style={{ background: 'var(--pulse-green)' }} />
              Aktive
            </div>
          </div>

          <div className="map-overlay-tr">
            <div className="map-controls">
              <div className="mctrl" title="Zoom in" onClick={zoomIn}>
                +
              </div>
              <div className="mctrl" title="Zoom out" onClick={zoomOut}>
                −
              </div>
              <div className="mctrl" title="Reset" onClick={resetMap}>
                ⌖
              </div>
            </div>
            <div className="map-legend">
              <div className="leg-title">Shëndeti i Tokës</div>
              <div className="leg-row">
                <div className="leg-dot" style={{ background: '#22c55e' }} />
                <span>Aktive (70–100)</span>
              </div>
              <div className="leg-row">
                <div className="leg-dot" style={{ background: '#f59e0b' }} />
                <span>Stres (40–69)</span>
              </div>
              <div className="leg-row">
                <div className="leg-dot" style={{ background: '#ef4444' }} />
                <span>Rrezik (0–39)</span>
              </div>
            </div>
          </div>

          <div className="map-source-badge">
            {mapReady
              ? osmStatus === 'ready'
                ? `OSM layers: ${osmCounts.landuse} land-use, ${osmCounts.adminareas} admin, ${osmCounts.water} water`
                : 'OSM layers unavailable'
              : 'Loading map'}
          </div>

          <div ref={mapContainerRef} id="leaflet-map" />

          {!mapReady && (
            <div className="detail-loading map-loading">
              <div>Loading map</div>
            </div>
          )}

          <div className="map-muni-tooltip" id="muni-tooltip">
            {isDetailView ? 'Kadastral detail view' : 'Regional land-use view'}
          </div>
        </section>

        <div className="bottom-panels">
          <div className="detail-panel" id="detail-panel">
            {!selectedParcel ? (
              <div className="no-selection" id="no-selection">
                <div className="ns-icon">🗺️</div>
                <div className="ns-text">Klikoni një parcelë<br />në hartë ose listë<br />për të parë të dhënat e plota</div>
              </div>
            ) : (
              <div id="parcel-detail">
                <div className="dp-header">
                  <div className="dp-id">{selectedParcel.id} · {selectedParcel.currentCrop} · {selectedParcel.hectares} ha</div>
                  <div className="dp-name">{selectedParcel.municipality}</div>
                  <div className="dp-meta">{selectedParcel.owner}</div>
                  <div className="dp-owner">
                    <span>👤 <strong>{selectedParcel.owner}</strong> · {selectedParcel.phone}</span>
                    <span className="tag green" style={{ marginLeft: 'auto' }}>
                      Demo
                    </span>
                  </div>
                </div>

                <div className="layer-tabs">
                  <div className={`ltab ${activeDetailTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveDetailTab('overview')}>
                    Pasqyra
                  </div>
                  <div className={`ltab ${activeDetailTab === 'blockchain' ? 'active' : ''}`} onClick={() => setActiveDetailTab('blockchain')}>
                    ⛓️ Regjistri
                  </div>
                  <div className={`ltab ${activeDetailTab === 'satellite' ? 'active' : ''}`} onClick={() => setActiveDetailTab('satellite')}>
                    🛰️ Satelit
                  </div>
                  <div className={`ltab ${activeDetailTab === 'advisor' ? 'active' : ''}`} onClick={() => setActiveDetailTab('advisor')}>
                    🤖 Këshilltar
                  </div>
                </div>

                {activeDetailTab === 'overview' && (
                  <div id="dt-overview">
                    <div className="dp-pulse-hero">
                      <div className="pulse-ring" style={{ '--ring-color': selectedParcel.status === 'Healthy' ? '#22c55e' : selectedParcel.status === 'Watch' ? '#f59e0b' : '#ef4444', '--ring-pct': `${selectedParcel.landHealthScore}%` }}>
                        <div className="pulse-ring-inner">
                          <div className="pv" style={{ color: selectedParcel.color }}>
                            {selectedParcel.landHealthScore}
                          </div>
                          <div className="pl">LAND PULSE</div>
                        </div>
                      </div>
                      <div className="pulse-info">
                        <div
                          className="pi-label"
                          style={{
                            background: selectedParcel.status === 'Healthy' ? 'rgba(34,197,94,0.12)' : selectedParcel.status === 'Watch' ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                            color: selectedParcel.status === 'Healthy' ? '#15803d' : selectedParcel.status === 'Watch' ? '#92400e' : '#991b1b'
                          }}
                        >
                          ● {selectedParcel.status}
                        </div>
                        <div className="pi-text">
                          {selectedParcel.hectares} ha · {Math.round((selectedParcel.abandonmentProbability ?? 0) * 100)}% braktisje e parashikuar
                        </div>
                        <div className="pi-ai">💡 {selectedParcel.advisory}</div>
                      </div>
                    </div>

                    <div className="timeline-section">
                      <div className="ts-title">Historiku 24-mujor — Land Pulse</div>
                      {renderTimeline(selectedParcel.cropHistory)}
                    </div>

                    <div className="risk-section">
                      <div className="ts-title">Probabiliteti i Braktisjes</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span className={`tag ${selectedParcel.status === 'Critical Alert' ? 'red' : selectedParcel.status === 'Watch' ? 'amber' : 'green'}`}>
                          {Math.round((selectedParcel.abandonmentProbability ?? 0) * 100)}% Probabilitet
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-soft)' }}>Bazuar në modelin TOKA</span>
                      </div>
                      <div className="risk-meter">
                        <div
                          className="risk-fill"
                          style={{
                            width: `${Math.round((selectedParcel.abandonmentProbability ?? 0) * 100)}%`,
                            background: selectedParcel.status === 'Critical Alert' ? '#ef4444' : selectedParcel.status === 'Watch' ? '#f59e0b' : '#22c55e'
                          }}
                        />
                      </div>
                      <div className="risk-econ">
                        <div className="re-item">
                          <div className="re-val">{formatter.format(selectedParcel.projectedLoss)}</div>
                          <div className="re-lab">Humbje proj.</div>
                        </div>
                        <div className="re-item">
                          <div className="re-val">{selectedParcel.hectares} ha</div>
                          <div className="re-lab">Sipërfaqe</div>
                        </div>
                        <div className="re-item">
                          <div className="re-val">{selectedParcel.complianceRisk}%</div>
                          <div className="re-lab">Rrezik</div>
                        </div>
                      </div>
                    </div>

                    <div className="risk-section">
                      <div className="ts-title">Zbërthimi i Land Pulse</div>
                      {renderPulseBreakdown(selectedParcel)}
                    </div>

                    <div className="actions-section">
                      <div className="ts-title" style={{ marginBottom: '8px' }}>Veprimet</div>
                      <div className="action-btns">
                        <button className="abtn primary" type="button" onClick={() => setChatInput('Dërgo SMS në shqip për këtë parcelë')}>
                          📱 SMS Shqip
                        </button>
                        <button className="abtn" type="button" onClick={() => setChatInput('Kontakto pronarin dhe kërko përditësim')}>
                          📞 Kontakto
                        </button>
                        <button className="abtn" type="button" onClick={() => setChatInput('Shëno parcelën si rrezik të mundshëm')}>
                          🚩 Shëno Rrezik
                        </button>
                        <button className="abtn" type="button" onClick={() => setChatInput('Gjenero raport PDF për këtë parcelë')}>
                          📄 Raporti PDF
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeDetailTab === 'blockchain' && (
                  <div id="dt-blockchain">
                    <div className="chain-section">
                      <div className="ts-title">Regjistri Blockchain i Aktiviteteve</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-soft)', marginBottom: '10px' }}>
                        Çdo veprim ruhet si rekord i pandryshueshëm. Hash-et janë të lidhura zinxhir.
                      </div>
                      <div className="chain-list">{renderBlockchain(selectedParcel.ledger)}</div>
                    </div>
                  </div>
                )}

                {activeDetailTab === 'satellite' && (
                  <SatellitePanel parcel={selectedParcel} />
                )}

                {activeDetailTab === 'advisor' && (
                  <AdvisorPanel
                    parcel={selectedParcel}
                    chatMessages={chatMessages}
                    chatInput={chatInput}
                    setChatInput={setChatInput}
                    sendChat={sendChat}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
