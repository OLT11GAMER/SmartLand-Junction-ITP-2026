import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle,
  Compass,
  Database,
  Eye,
  Layers3,
  MapPinned,
  ShieldCheck,
  Search,
  UserRound
} from 'lucide-react';
import {
  adminUser,
  detailedParcels,
  kosovoBounds,
  municipalityStats,
  regionalSummaryData
} from './data/landData';

const DETAIL_ZOOM = 11.5;
const SAMPLE_PARCEL_ID = 'KOS-LPJ-000613';
const HIDDEN_POPUP_PARCEL_IDS = new Set(['KOS-LPJ-000699']);
const EMPTY_COLLECTION = {
  type: 'FeatureCollection',
  features: []
};
const VIEW_MODE_STORAGE_KEY = 'toka_view_mode_v3';
const DEMO_PAGE_STORAGE_KEY = 'toka_demo_page_v3';
const DEMO_HTML_PAGES = {
  login: '/kinda%20newer%20html/index.html',
  farmer: '/kinda%20newer%20html/farmer.html',
  admin: '/kinda%20newer%20html/admin.html'
};

function geoJsonBoundsToLatLng(bounds) {
  return L.latLngBounds(bounds.map(([lng, lat]) => [lat, lng]));
}

const KOSOVO_LAT_LNG_BOUNDS = geoJsonBoundsToLatLng(kosovoBounds);

function geoJsonPolygonToLatLngs(coordinates) {
  if (!coordinates) return [];
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    return [coordinates[1], coordinates[0]];
  }

  return coordinates.map((child) => geoJsonPolygonToLatLngs(child));
}

function expandLatLngBounds(bounds, scale = 2) {
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  const center = bounds.getCenter();
  const latHalf = Math.abs(northEast.lat - southWest.lat) * scale / 2;
  const lngHalf = Math.abs(northEast.lng - southWest.lng) * scale / 2;

  return L.latLngBounds([
    [center.lat - latHalf, center.lng - lngHalf],
    [center.lat + latHalf, center.lng + lngHalf]
  ]);
}

function buildKosovoOutsideMask(feature) {
  const outerBounds = expandLatLngBounds(KOSOVO_LAT_LNG_BOUNDS, 2);
  const southWest = outerBounds.getSouthWest();
  const northEast = outerBounds.getNorthEast();
  const outerRing = [
    [southWest.lat, southWest.lng],
    [southWest.lat, northEast.lng],
    [northEast.lat, northEast.lng],
    [northEast.lat, southWest.lng],
    [southWest.lat, southWest.lng]
  ];
  const holeRing = geoJsonPolygonToLatLngs(feature?.geometry?.coordinates?.[0]);
  return holeRing.length ? [outerRing, holeRing] : [outerRing];
}

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

function parcelBounds(parcel) {
  const points = [];
  const walk = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      points.push([coords[1], coords[0]]);
      return;
    }
    coords.forEach(walk);
  };

  walk(parcel?.geometry?.coordinates);
  return points.length ? L.latLngBounds(points) : null;
}

function buildParcelPopup(parcel) {
  if (!parcel || HIDDEN_POPUP_PARCEL_IDS.has(parcel.id)) return '';

  const confidence = parcel.status === 'Healthy' ? 92 : parcel.status === 'Watch' ? 74 : 56;
  const sourceLabel = parcel.id === SAMPLE_PARCEL_ID ? 'Prime example' : 'Live parcel';

  return `
    <div class="parcel-popup">
      <div class="parcel-popup-head">
        <div>
          <div class="parcel-popup-id">${parcel.id}</div>
          <div class="parcel-popup-sub">${parcel.municipality} · ${parcel.currentCrop}</div>
        </div>
        <div class="parcel-popup-badge">${sourceLabel}</div>
      </div>
      <div class="parcel-popup-grid">
        <div class="parcel-popup-stat">
          <span class="label">Deklaruar nga fermeri</span>
          <strong>${parcel.owner}</strong>
        </div>
        <div class="parcel-popup-stat">
          <span class="label">Satelit / Ndërveprim</span>
          <strong>${parcel.status === 'Healthy' ? 'Aligned' : parcel.status === 'Watch' ? 'Review' : 'Mismatch'}</strong>
        </div>
        <div class="parcel-popup-stat">
          <span class="label">Confidence</span>
          <strong>${confidence}%</strong>
        </div>
        <div class="parcel-popup-stat">
          <span class="label">Land Pulse</span>
          <strong>${parcel.landHealthScore}/100</strong>
        </div>
      </div>
      <div class="parcel-popup-note">
        Prioritize outreach, verify seasonal activity, and recommend crop rotation before field inspection.
      </div>
    </div>
  `;
}

function buildParcelPanel(parcel) {
  if (!parcel || HIDDEN_POPUP_PARCEL_IDS.has(parcel.id)) return '';

  const confidence = parcel.status === 'Healthy' ? 92 : parcel.status === 'Watch' ? 74 : 56;
  const statusLabel = parcel.status === 'Healthy' ? 'Aligned' : parcel.status === 'Watch' ? 'Review' : 'Mismatch';
  const note = parcel.advisory || 'Prioritize outreach, verify seasonal activity, and recommend crop rotation before field inspection.';

  return `
    <div class="parcel-panel">
      <div class="parcel-panel-head">
        <div>
          <div class="parcel-panel-id">${parcel.id}</div>
          <div class="parcel-panel-sub">${parcel.municipality} · ${parcel.currentCrop}</div>
        </div>
        <div class="parcel-panel-badge">${parcel.id === SAMPLE_PARCEL_ID ? 'Prime example' : 'Live parcel'}</div>
      </div>
      <div class="parcel-panel-grid">
        <div class="parcel-panel-stat">
          <span class="label">Owner</span>
          <strong>${parcel.owner}</strong>
        </div>
        <div class="parcel-panel-stat">
          <span class="label">Status</span>
          <strong>${statusLabel}</strong>
        </div>
        <div class="parcel-panel-stat">
          <span class="label">Confidence</span>
          <strong>${confidence}%</strong>
        </div>
        <div class="parcel-panel-stat">
          <span class="label">Land Pulse</span>
          <strong>${parcel.landHealthScore}/100</strong>
        </div>
      </div>
      <div class="parcel-panel-note">${note}</div>
    </div>
  `;
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
    <div className="border border-[var(--border)] bg-white/86 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text-soft)]">{label}</div>
          <div className="mt-2 text-2xl font-extrabold text-[var(--forest)]">{value}</div>
        </div>
        <div className="grid h-10 w-10 place-items-center bg-[var(--sage-pale)] text-[var(--sage)]">
          <Icon size={19} />
        </div>
      </div>
      <div className="mt-2 text-xs leading-5 text-[var(--text-mid)]">{sub}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 border border-[var(--border)] bg-white/92 p-3 shadow-lg backdrop-blur">
      <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-[var(--text-soft)]">Parcel status</div>
      {[
        ['#1f923b', 'Healthy'],
        ['#48acf0', 'Watch'],
        ['#4b1b07', 'Critical Alert']
      ].map(([color, label]) => (
        <div key={label} className="flex items-center gap-2 py-1 text-xs font-semibold text-[var(--forest)]">
          <span className="h-3 w-3 border border-black/10" style={{ backgroundColor: color }} />
          {label}
        </div>
      ))}
    </div>
  );
}

function MapBadge({ label, value }) {
  return (
    <div className="border border-[var(--border)] bg-white/92 px-3 py-2 text-xs font-bold text-[var(--forest)] shadow-lg backdrop-blur">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--text-soft)]">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function BrandLogo() {
  return (
    <img src="/logo.svg" alt="TOKA" />
  );
}

function AppModeSwitch({ viewMode, setViewMode }) {
  return (
    <div className="app-mode-switch" role="group" aria-label="Switch between React app and HTML demo">
      <button
        type="button"
        className={`app-mode-switch-btn ${viewMode === 'app' ? 'active' : ''}`}
        onClick={() => setViewMode('app')}
      >
        React App
      </button>
      <button
        type="button"
        className={`app-mode-switch-btn ${viewMode === 'demo' ? 'active' : ''}`}
        onClick={() => setViewMode('demo')}
      >
        HTML Demo
      </button>
    </div>
  );
}

function DemoRoleSwitch({ authUser, onSelectRole }) {
  return (
    <div className="demo-role-switch" role="group" aria-label="Switch React sample role">
      <button
        type="button"
        className={`demo-role-switch-btn ${authUser?.role === 'farmer' ? 'active' : ''}`}
        onClick={() => onSelectRole('farmer')}
      >
        Farmer
      </button>
      <button
        type="button"
        className={`demo-role-switch-btn ${authUser?.role === 'admin' ? 'active' : ''}`}
        onClick={() => onSelectRole('admin')}
      >
        Admin
      </button>
    </div>
  );
}

function HtmlDemoView({ demoPage, setDemoPage }) {
  const [toolbarOpen, setToolbarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !window.matchMedia('(max-width: 860px)').matches;
  });
  const src = DEMO_HTML_PAGES[demoPage] || DEMO_HTML_PAGES.login;

  return (
    <div className={`demo-shell ${toolbarOpen ? 'demo-shell-open' : 'demo-shell-collapsed'}`}>
      <button
        type="button"
        className="demo-toolbar-toggle"
        onClick={() => setToolbarOpen((value) => !value)}
        aria-expanded={toolbarOpen}
        aria-controls="demo-toolbar"
      >
        {toolbarOpen ? 'Hide demo controls' : 'Demo'}
      </button>
      <div className={`demo-toolbar ${toolbarOpen ? 'is-open' : 'is-collapsed'}`} id="demo-toolbar">
        <div>
          <div className="demo-title">TOKA HTML Demo</div>
          <div className="demo-subtitle">Static old HTML views connected to the React app.</div>
        </div>
        <div className="mode-switcher-pages">
          {[
            ['login', 'Login'],
            ['farmer', 'Farmer'],
            ['admin', 'Admin']
          ].map(([page, label]) => (
            <button
              key={page}
              type="button"
              className={`mode-switcher-page ${demoPage === page ? 'active' : ''}`}
              onClick={() => setDemoPage(page)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <iframe
        key={demoPage}
        title={`TOKA ${demoPage} demo`}
        className="demo-frame"
        src={src}
      />
    </div>
  );
}

const AUTH_STORAGE_KEY = 'toka_user';

const DEMO_ACCOUNTS = {
  '1234567890': {
    nid: '1234567890',
    password: 'toka123',
    name: 'Agim Berisha',
    municipality: 'Prizren',
    role: 'farmer',
    parcels: '3 parcels',
    area: '4.7 ha',
    status: 'Aktiv'
  },
  '9876543210': {
    nid: '9876543210',
    password: 'toka123',
    name: 'Drita Gashi',
    municipality: 'Prishtinë',
    role: 'farmer',
    parcels: '1 parcel',
    area: '1.2 ha',
    status: 'Aktiv'
  },
  admin: {
    nid: 'admin',
    password: 'admin123',
    name: 'Admin Komunal',
    municipality: 'Kosovo',
    role: 'admin',
    parcels: 'All parcels',
    area: 'National view',
    status: 'Administrator'
  }
};

const DEMO_AKK = {
  '1234567890': DEMO_ACCOUNTS['1234567890'],
  '9876543210': DEMO_ACCOUNTS['9876543210'],
  '1111111111': {
    nid: '1111111111',
    name: 'Blerim Musliu',
    municipality: 'Pejë',
    role: 'farmer',
    parcels: '2 parcels',
    area: '3.1 ha',
    status: 'Aktiv'
  }
};

function AuthView({ onAuth, viewMode, setViewMode }) {
  const [tab, setTab] = useState('login');
  const [loginNid, setLoginNid] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [signupNid, setSignupNid] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPassword2, setSignupPassword2] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [akkRecord, setAkkRecord] = useState(null);
  const [step2Visible, setStep2Visible] = useState(false);

  const showTab = (nextTab) => {
    setTab(nextTab);
    setLoginError('');
  };

  const lookupAKK = () => {
    const nid = signupNid.trim();
    setLookupError('');
    if (nid.length < 4) return;

    setLookupLoading(true);
    window.setTimeout(() => {
      const record = DEMO_AKK[nid];
      setLookupLoading(false);
      if (!record) {
        setLookupError('NID nuk u gjet në bazën e të dhënave të AKK. Kontrolloni dhe provoni përsëri.');
        setAkkRecord(null);
        setStep2Visible(false);
        return;
      }

      setAkkRecord(record);
      setStep2Visible(true);
      setLookupError('');
    }, 700);
  };

  const doLogin = () => {
    const nid = loginNid.trim();
    const record = DEMO_ACCOUNTS[nid];
    if (!record || record.password !== loginPassword) {
      setLoginError('NID ose fjalëkalimi është gabim. Provoni përsëri.');
      return;
    }

    onAuth({
      nid: record.nid,
      name: record.name,
      role: record.role,
      municipality: record.municipality
    });
  };

  const doAdminLogin = () => {
    const record = DEMO_ACCOUNTS.admin;
    onAuth({
      nid: record.nid,
      name: record.name,
      role: record.role,
      municipality: record.municipality
    });
  };

  const doFarmerLogin = () => {
    const record = DEMO_ACCOUNTS['1234567890'];
    onAuth({
      nid: record.nid,
      name: record.name,
      role: record.role,
      municipality: record.municipality
    });
  };

  const doSignup = () => {
    if (!akkRecord) return;
    if (!signupEmail.trim() || !signupPassword.trim() || !signupPassword2.trim()) return;
    if (signupPassword !== signupPassword2) {
      setLoginError('Fjalëkalimet nuk përputhen.');
      setTab('login');
      return;
    }

    onAuth({
      nid: akkRecord.nid,
      name: akkRecord.name,
      role: 'farmer',
      municipality: akkRecord.municipality
    });
  };

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="left-bg" />
        <div className="left-texture" />

        <div className="left-content">
          <div className="brand">
            <div className="brand-hex">
              <BrandLogo />
            </div>
            <div>
              <div className="brand-name">TOKA</div>
              <div className="brand-tag">Sistemi i Shëndetit të Tokës</div>
            </div>
          </div>

          <div className="left-headline">
            Toka juaj ka<br />një <em>histori</em> të gjallë
          </div>
          <div className="left-sub">
            Sistemi TOKA mbron tokën kosovare duke ndjekur gjendjen e çdo parcele në kohë reale.
          </div>

          <div className="features">
            <div className="feat">
              <div className="feat-icon">⛓</div>
              <div className="feat-text">
                <strong>Regjistër i pandryshueshëm</strong>
                Çdo aktivitet i tokës ruhet dhe mund të verifikohet më vonë.
              </div>
            </div>
            <div className="feat">
              <div className="feat-icon">🛰</div>
              <div className="feat-text">
                <strong>Verifikim satelitor</strong>
                Mbikëqyrje vizuale për të dalluar stresin dhe ndryshimet e parcelave.
              </div>
            </div>
            <div className="feat">
              <div className="feat-icon">💬</div>
              <div className="feat-text">
                <strong>Këshillues AI në shqip</strong>
                Pyesni gjithçka rreth tokës suaj nga një ndërfaqe e thjeshtë.
              </div>
            </div>
          </div>
        </div>

        <div className="left-footer">
          <div className="akk-badge">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="2" width="14" height="14" rx="3" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" />
              <path d="M5 9l3 3 5-5" stroke="rgba(160,220,164,0.8)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>
              <span>E lidhur me </span>
              <strong>AKK — Agjencia Kadastrale e Kosovës</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-right">
        <div className="form-card">
          <div className="auth-mode-switch">
            <AppModeSwitch viewMode={viewMode} setViewMode={setViewMode} />
          </div>
          <div className="form-title">{tab === 'login' ? 'Mirë se kthyet' : 'Regjistrim i Ri'}</div>
          <div className="form-sub">
            {tab === 'login'
              ? 'Hyni me numrin tuaj personal të identitetit dhe fjalëkalimin e regjistruar.'
              : 'Shkruani numrin tuaj personal. Ne do të marrim informacionin nga baza e të dhënave të AKK.'}
          </div>

          <div className="tabs">
            <div className={`tab ${tab === 'login' ? 'active' : ''}`} onClick={() => showTab('login')}>
              Hyrje
            </div>
            <div className={`tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => showTab('signup')}>
              Regjistrim i Ri
            </div>
          </div>

          {tab === 'login' ? (
            <div>
              <div className="field">
                <label>Numri Personal (NID) <span className="req">*</span></label>
                <div className="input-wrap">
                  <span className="icon">🪪</span>
                  <input
                    type="text"
                    value={loginNid}
                    onChange={(event) => setLoginNid(event.target.value)}
                    placeholder="p.sh. 1234567890"
                    maxLength={10}
                  />
                </div>
              </div>

              <div className="field">
                <label>Fjalëkalimi <span className="req">*</span></label>
                <div className="input-wrap">
                  <span className="icon">🔒</span>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder="Shkruani fjalëkalimin tuaj"
                  />
                </div>
                <div className={`error-msg ${loginError ? 'show' : ''}`}>{loginError || 'NID ose fjalëkalimi është gabim. Provoni përsëri.'}</div>
              </div>

              <button className="submit-btn" type="button" onClick={doLogin}>
                <span>Hyrja në TOKA</span>
                <span>→</span>
              </button>

              <div className="quick-login-grid">
                <button className="quick-login-btn" type="button" onClick={doFarmerLogin}>
                  Hyr si fermer
                </button>
                <button className="quick-login-btn secondary" type="button" onClick={doAdminLogin}>
                  Hyr si administrator
                </button>
              </div>

              <div className="form-link">
                Nuk keni llogari? <a onClick={() => showTab('signup')}>Regjistrohuni</a>
              </div>
              <div className="admin-link">
                Punonjës i Autoriteteve Lokale/Institucioneve? <a onClick={doAdminLogin}>Hyni si Administrator →</a>
              </div>
              <div className="admin-link" style={{ borderTop: 'none', marginTop: '12px', paddingTop: 0 }}>
                Demo ferma: 1234567890 / toka123
              </div>
            </div>
          ) : (
            <div>
              <div className="field">
                <label>Numri Personal (NID) <span className="req">*</span></label>
                <div className="id-row">
                  <div className="input-wrap" style={{ flex: 1 }}>
                    <span className="icon">🪪</span>
                    <input
                      type="text"
                      value={signupNid}
                      onChange={(event) => setSignupNid(event.target.value)}
                      placeholder="10 shifra"
                      maxLength={10}
                    />
                  </div>
                  <button
                    className={`lookup-btn ${lookupLoading ? 'loading' : ''}`}
                    type="button"
                    onClick={lookupAKK}
                  >
                    {lookupLoading ? 'Duke kërkuar…' : 'Kërko AKK'}
                  </button>
                </div>
                <div className={`error-msg ${lookupError ? 'show' : ''}`}>{lookupError || 'NID nuk u gjet në bazën e të dhënave të AKK. Kontrolloni dhe provoni përsëri.'}</div>
              </div>

              {akkRecord && step2Visible && (
                <>
                  <div className="akk-result show">
                    <div className="akk-result-header">
                      <div className="dot" />
                      <span>Gjendja nga AKK — Verifikuar</span>
                    </div>
                    <div className="akk-grid">
                      <div className="akk-item"><label>Emri</label><p>{akkRecord.name}</p></div>
                      <div className="akk-item"><label>NID</label><p>{akkRecord.nid}</p></div>
                      <div className="akk-item"><label>Komuna</label><p>{akkRecord.municipality}</p></div>
                      <div className="akk-item"><label>Parcela</label><p>{akkRecord.parcels || '—'}</p></div>
                      <div className="akk-item"><label>Sipërfaqja</label><p>{akkRecord.area || '—'}</p></div>
                      <div className="akk-item"><label>Statusi</label><p style={{ color: 'var(--sage)' }}>{akkRecord.status || 'Aktiv'}</p></div>
                    </div>
                  </div>

                  <div id="step2-fields">
                    <div className="divider"><span>Plotësoni të dhënat tuaja</span></div>
                    <div className="field">
                      <label>Email <span className="req">*</span></label>
                      <div className="input-wrap">
                        <span className="icon">✉️</span>
                        <input
                          type="email"
                          value={signupEmail}
                          onChange={(event) => setSignupEmail(event.target.value)}
                          placeholder="emri@shembull.com"
                        />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Fjalëkalimi <span className="req">*</span></label>
                        <div className="input-wrap">
                          <span className="icon">🔒</span>
                          <input
                            type="password"
                            value={signupPassword}
                            onChange={(event) => setSignupPassword(event.target.value)}
                            placeholder="Min. 8 karaktere"
                          />
                        </div>
                      </div>
                      <div className="field">
                        <label>Konfirmo <span className="req">*</span></label>
                        <div className="input-wrap">
                          <span className="icon">🔒</span>
                          <input
                            type="password"
                            value={signupPassword2}
                            onChange={(event) => setSignupPassword2(event.target.value)}
                            placeholder="Përsërit"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="field">
                      <label>Numri i telefonit</label>
                      <div className="input-wrap">
                        <span className="icon">📱</span>
                        <input
                          type="tel"
                          value={signupPhone}
                          onChange={(event) => setSignupPhone(event.target.value)}
                          placeholder="+383 4X XXX XXX"
                        />
                      </div>
                    </div>
                    <button className="submit-btn" type="button" onClick={doSignup}>
                      <span>Krijo Llogarinë</span>
                      <span>✓</span>
                    </button>
                  </div>
                </>
              )}

              <div className="form-link" style={{ marginTop: '16px' }}>
                Keni llogari? <a onClick={() => showTab('login')}>Hyni këtu</a>
              </div>
            </div>
          )}
        </div>
      </div>
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
  const confidence = 56;
  return (
    <div className="sat-section">
      <div className="ts-title">Krahasimi satelitor</div>
      <div className="sat-compare">
        <div className="sat-panel sat-panel-farmer">
          <div className="sat-panel-label">Deklaruar nga fermeri</div>
        </div>
        <div className="sat-panel sat-panel-satellite">
          <div className="sat-panel-label">Satelit / Ndërveprim</div>
        </div>
      </div>
      <div className="sat-confidence">
        <div className="sat-confidence-row">
          <span>Confidence</span>
          <strong>{confidence}%</strong>
        </div>
        <div className="sat-conf-bar">
          <div className="sat-conf-fill" style={{ width: `${confidence}%` }} />
        </div>
      </div>
      <div className="sat-advisory">
        Prioritize outreach, verify seasonal activity, and recommend crop rotation before field inspection.
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

function FloatingChatButton({ label, onClick }) {
  return (
    <button className="chatbot-fab" type="button" onClick={onClick} aria-label={label}>
      <span className="chatbot-fab-icon">🤖</span>
      <span className="chatbot-fab-text">{label}</span>
    </button>
  );
}

function AdminMobileNav({ sidebarOpen, setSidebarOpen, adminMobileView, setAdminMobileView, activeDetailTab, setActiveDetailTab }) {
  const openDetail = (tab = 'overview') => {
    setAdminMobileView('detail');
    setActiveDetailTab(tab);
  };

  return (
    <nav className="mobile-nav admin-mobile-nav" aria-label="Admin mobile navigation">
      <div className="mobile-nav-inner">
        <button
          className={`mnav-btn ${adminMobileView === 'map' ? 'active' : ''}`}
          onClick={() => setAdminMobileView('map')}
          type="button"
        >
          <span className="mnav-icon">🗺️</span>
          <span className="mnav-label">Harta</span>
        </button>
        <button
          className={`mnav-btn ${sidebarOpen ? 'active' : ''}`}
          onClick={() => setSidebarOpen((value) => !value)}
          type="button"
        >
          <span className="mnav-icon">🗂️</span>
          <span className="mnav-label">Lista</span>
        </button>
        <button
          className={`mnav-btn ${adminMobileView === 'detail' ? 'active' : ''}`}
          onClick={() => openDetail('overview')}
          type="button"
        >
          <span className="mnav-icon">📋</span>
          <span className="mnav-label">Detaje</span>
        </button>
        <button
          className={`mnav-btn ${adminMobileView === 'detail' && activeDetailTab === 'advisor' ? 'active' : ''}`}
          onClick={() => openDetail('advisor')}
          type="button"
        >
          <span className="mnav-icon">🤖</span>
          <span className="mnav-label">AI</span>
        </button>
      </div>
    </nav>
  );
}

function FarmerDashboard({
  authUser,
  selectedParcel,
  setSelectedId,
  focusParcel,
  searchTerm,
  setSearchTerm,
  filteredParcels = [],
  filterMode,
  setFilterMode,
  mapContainerRef,
  mapRef,
  mapReady,
  osmStatus,
  osmCounts,
  zoom,
  isDetailView,
  handleLogout,
  chatMessages,
  chatInput,
  setChatInput,
  sendChat
}) {
  const [mobileView, setMobileView] = useState('map');
  const [activeTab, setActiveTab] = useState('detail');

  const farmerParcels = filteredParcels;

  useEffect(() => {
    if (!farmerParcels.length) return;
    const stillOwned = farmerParcels.some((parcel) => parcel.id === selectedParcel.id);
    if (!stillOwned) {
      setSelectedId(farmerParcels[0].id);
    }
  }, [farmerParcels, selectedParcel.id, setSelectedId]);

  return (
    <div className="app-shell farmer-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-hex">
            <BrandLogo />
          </div>
          <div>
            <div className="brand-name">TOKA</div>
            <div className="brand-tag">Sistemi i Shëndetit të Tokës</div>
          </div>
        </div>

        <div className="topbar-center">
          <div className="topbar-search">
            <Search size={14} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Kërko parcelë, komuna…"
            />
          </div>
        </div>

        <button className="hamburger" type="button" onClick={() => setMobileView('list')} aria-label="Open panels">
          ☰
        </button>

        <div className="topbar-right">
          <div className="live-badge">
            <div className="live-dot" />
            <span>Live — Farmer View</span>
          </div>
          <div className="admin-chip">
            <div className="admin-av">{authUser.name.slice(0, 2).toUpperCase()}</div>
            <span>{authUser.name}</span>
          </div>
          <button className="toka-top-btn" type="button" onClick={handleLogout}>
            Dil
          </button>
        </div>
      </header>

      <div
        className={`sidebar-overlay ${mobileView === 'list' ? 'visible' : ''}`}
        onClick={() => setMobileView('map')}
        role="presentation"
      />

      <aside className={`sidebar ${mobileView === 'list' ? 'open' : ''}`}>
        <button className="sidebar-close" type="button" onClick={() => setMobileView('map')}>
          ✕
        </button>
          <div className="sidebar-section">
            <div className="stat-grid">
              <div className="stat-card good">
                <div className="sv">{farmerParcels.length}</div>
                <div className="sl">Your parcels</div>
            </div>
              <div className="stat-card good">
              <div className="sv">{Math.round(farmerParcels.reduce((sum, parcel) => sum + parcel.landHealthScore, 0) / Math.max(1, farmerParcels.length))}</div>
              <div className="sl">Avg health</div>
            </div>
            <div className="stat-card danger">
              <div className="sv">{farmerParcels.filter((parcel) => parcel.status === 'Critical Alert').length}</div>
              <div className="sl">Alerts</div>
            </div>
            <div className="stat-card warn">
              <div className="sv">{formatter.format(farmerParcels.reduce((sum, parcel) => sum + parcel.projectedLoss, 0))}</div>
              <div className="sl">Projected loss</div>
            </div>
          </div>
        </div>

        <div className="sidebar-section sidebar-insights-section">
          <div className="insights-panel">
            <div className="municipality-card active">
              <div className="card-top">
                <div>
                  <div className="brand-tag" style={{ color: 'rgba(255,255,255,0.4)' }}>Toka ime</div>
                  <h3>{selectedParcel.municipality}</h3>
                </div>
                <div className="score-box">{selectedParcel.landHealthScore}</div>
              </div>
              <div className={`risk-badge ${selectedParcel.status === 'Healthy' ? 'positive' : selectedParcel.status === 'Watch' ? 'medium' : 'negative'}`}>
                {selectedParcel.status}
              </div>
              <div className="card-content">
                <div className="info-row"><span>Current crop</span><span className="positive">{selectedParcel.currentCrop}</span></div>
                <div className="info-row"><span>Owner</span><span>{selectedParcel.owner}</span></div>
                <div className="info-row"><span>Projected loss</span><span>{formatter.format(selectedParcel.projectedLoss)}</span></div>
                <div className="expanded-info">
                  <p>{selectedParcel.advisory}</p>
                </div>
              </div>
            </div>
            <div className="ins-card">
              <div className="ins-title">
                <MapPinned size={13} />
                Your parcels
              </div>
              <table className="muni-table">
                <thead>
                  <tr>
                    <th>Parcel</th>
                    <th>Crop</th>
                    <th>Pulse</th>
                  </tr>
                </thead>
                <tbody>
                  {farmerParcels.slice(0, 5).map((parcel) => (
                    <tr key={parcel.id}>
                      <td>{parcel.id}</td>
                      <td>{parcel.currentCrop}</td>
                      <td>{parcel.landHealthScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="ss-label">Parcelet tuaja</div>
          <div className="parcel-list">
            {farmerParcels.map((parcel) => {
              const color = parcel.status === 'Healthy' ? '#22c55e' : parcel.status === 'Watch' ? '#f59e0b' : '#ef4444';
              return (
                <div
                  key={parcel.id}
                  className={`pitem ${selectedParcel.id === parcel.id ? 'active' : ''}`}
                  onClick={() => {
                    focusParcel(parcel);
                    setMobileView('detail');
                    setActiveTab('detail');
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="pitem-pulse" style={{ background: color }}>{parcel.landHealthScore}</div>
                  <div className="pitem-info">
                    <div className="pitem-name">{parcel.id}</div>
                    <div className="pitem-sub">{parcel.municipality} · {parcel.hectares} ha</div>
                  </div>
                  <div className="pitem-score" style={{ color }}>{parcel.status === 'Healthy' ? 'Aktive' : parcel.status === 'Watch' ? 'Stres' : 'Rrezik'}</div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="main farmer-main">
        <section className="map-wrapper" id="map-wrapper">
          <div className="map-overlay-tl">
            <div className="map-badge">
              <Eye size={12} />
              Kosovo farm view
            </div>
            <div className="map-badge">
              📍 <span>{selectedParcel.municipality}</span>
            </div>
          </div>

          <div className="map-filter">
            <div className={`tpill ${filterMode === 'all' ? 'active' : ''}`} onClick={() => setFilterMode('all')}>
              <span className="dot" style={{ background: '#64748b' }} />
              All
            </div>
            <div className={`tpill ${filterMode === 'risk' ? 'active' : ''}`} onClick={() => setFilterMode('risk')}>
              <span className="dot" style={{ background: 'var(--pulse-red)' }} />
              Risk
            </div>
            <div className={`tpill ${filterMode === 'stress' ? 'active' : ''}`} onClick={() => setFilterMode('stress')}>
              <span className="dot" style={{ background: 'var(--pulse-amber)' }} />
              Stress
            </div>
            <div className={`tpill ${filterMode === 'thriving' ? 'active' : ''}`} onClick={() => setFilterMode('thriving')}>
              <span className="dot" style={{ background: 'var(--pulse-green)' }} />
              Active
            </div>
          </div>

          <div className="map-overlay-tr">
            <div className="map-controls">
              <div className="mctrl" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</div>
              <div className="mctrl" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</div>
              <div className="mctrl" title="Reset" onClick={() => mapRef.current?.fitBounds([[41.82, 19.85], [43.32, 21.95]], { padding: 36, duration: 700 })}>⌖</div>
            </div>
            <div className="map-legend">
              <div className="leg-title">Land Pulse</div>
              <div className="leg-row"><div className="leg-dot" style={{ background: '#22c55e' }} /><span>Active (70–100)</span></div>
              <div className="leg-row"><div className="leg-dot" style={{ background: '#f59e0b' }} /><span>Stress (40–69)</span></div>
              <div className="leg-row"><div className="leg-dot" style={{ background: '#ef4444' }} /><span>Risk (0–39)</span></div>
            </div>
          </div>

          <div ref={mapContainerRef} id="leaflet-map" />
          {!mapReady && (
            <div className="detail-loading map-loading">
              <div>Loading map</div>
            </div>
          )}

          <button className="farm-map-fab" type="button" onClick={() => setMobileView((value) => (value === 'map' ? 'list' : 'map'))}>
            {mobileView === 'map' ? 'Parcelet' : 'Harta'}
          </button>
          <button className="farm-map-fab secondary" type="button" onClick={() => setMobileView('detail')}>
            Detajet
          </button>
        </section>

        <div className={`right-panel farmer-right ${mobileView === 'detail' ? 'mobile-visible' : ''}`}>
          <div className="panel-tabs">
            <div className={`ptab ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>📋 Detajet</div>
            <div className={`ptab ${activeTab === 'satellite' ? 'active' : ''}`} onClick={() => setActiveTab('satellite')}>🛰️ Satelit</div>
            <div className={`ptab ${activeTab === 'chain' ? 'active' : ''}`} onClick={() => setActiveTab('chain')}>⛓️ Histori</div>
            <div className={`ptab ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveTab('ai')}>🤖 Këshilltar</div>
          </div>
          <div className="panel-content">
            {activeTab === 'detail' && (
              <>
                <div className="detail-hero">
                  <div className="detail-hero-top">
                    <div>
                      <div className="detail-title">{selectedParcel.id}</div>
                      <div className="detail-subtitle">{selectedParcel.municipality} · {selectedParcel.hectares} ha</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                      <StatusPill status={selectedParcel.status} />
                      <button className="ai-launch-btn" type="button" onClick={() => setActiveTab('ai')}>
                        🤖 Këshilltari AI
                      </button>
                    </div>
                  </div>
                  <div className="pulse-ring">
                    <div className="pulse-number">{selectedParcel.landHealthScore}</div>
                    <div className="pulse-label">LAND PULSE</div>
                  </div>
                  <div className="pulse-bar">
                    <div className="pulse-fill" style={{ width: `${selectedParcel.landHealthScore}%`, background: selectedParcel.status === 'Healthy' ? '#22c55e' : selectedParcel.status === 'Watch' ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <div className="pulse-status">{selectedParcel.status}</div>
                  <div className="detail-meta">
                    <div className="dmeta"><div className="dmeta-label">Current crop</div><div className="dmeta-val">{selectedParcel.currentCrop}</div></div>
                    <div className="dmeta"><div className="dmeta-label">Owner</div><div className="dmeta-val">{selectedParcel.owner}</div></div>
                  </div>
                </div>
                <div className="farmer-summary-grid">
                  <div className="farmer-summary-card">
                    <div className="fsc-label">Next action</div>
                    <div className="fsc-value">{selectedParcel.monocultureYears > 4 ? 'Rotate crop' : 'Maintain schedule'}</div>
                  </div>
                  <div className="farmer-summary-card">
                    <div className="fsc-label">Satellite match</div>
                    <div className="fsc-value">{selectedParcel.status === 'Healthy' ? 'Aligned' : 'Review'}</div>
                  </div>
                  <div className="farmer-summary-card">
                    <div className="fsc-label">Risk</div>
                    <div className="fsc-value">{Math.round((selectedParcel.abandonmentProbability ?? 0) * 100)}%</div>
                  </div>
                </div>
                <div className="ai-explain">
                  <div className="ai-explain-header">
                    <div className="ai-icon">AI</div>
                    <div className="ai-label">Farm advisory</div>
                  </div>
                  <div className="ai-text">{selectedParcel.advisory}</div>
                </div>
                <div className="abandon-card">
                  <div className="abandon-header">
                    <div className="abandon-icon">⚠️</div>
                    <div>
                      <div className="abandon-title">Abandonment risk</div>
                      <div className="abandon-label">Based on activity + satellite</div>
                    </div>
                  </div>
                  <div className="abandon-prob">{Math.round((selectedParcel.abandonmentProbability ?? 0) * 100)}%</div>
                  <div className="economic-row">
                    <div className="econ-chip"><div className="econ-val">{formatter.format(selectedParcel.projectedLoss)}</div><div className="econ-label">Projected loss</div></div>
                    <div className="econ-chip"><div className="econ-val">{selectedParcel.complianceRisk}%</div><div className="econ-label">Compliance risk</div></div>
                  </div>
                </div>
                <div className="timeline-wrap">
                  <div className="section-label">24-month timeline</div>
                  <div className="timeline-chart">
                    {selectedParcel.cropHistory.map((point, index) => (
                      <div
                        key={`${point.month}-${index}`}
                        className="tbar"
                        data-tip={`${point.month}: ${point.ndvi}`}
                        style={{ background: point.ndvi >= 70 ? '#22c55e' : point.ndvi >= 40 ? '#f59e0b' : '#ef4444', height: `${Math.max(10, Math.round((point.ndvi / 100) * 50))}px` }}
                      />
                    ))}
                  </div>
                  <div className="timeline-labels"><span>−24 mo</span><span>−12 mo</span><span>Now</span></div>
                </div>
                <div className="actions-grid" style={{ marginTop: '14px' }}>
                  <button className="action-btn" type="button" onClick={() => setActiveTab('ai')}>
                    <div className="action-icon" style={{ background: 'var(--sage-pale)', color: 'var(--sage)' }}>🤖</div>
                    <div className="action-body">
                      <div className="action-title">Open chatbot</div>
                      <div className="action-desc">Ask about planting, risk, or weather impact</div>
                    </div>
                    <div className="action-arrow">→</div>
                  </button>
                </div>
              </>
            )}

            {activeTab === 'satellite' && <SatellitePanel parcel={selectedParcel} />}
            {activeTab === 'chain' && <div className="chain-wrap">{renderBlockchain(selectedParcel.ledger)}</div>}
            {activeTab === 'ai' && (
              <>
                <div className="chat-launch-badge">🤖 Chat bot aktiv për këtë parcelë</div>
                <AdvisorPanel
                  parcel={selectedParcel}
                  chatMessages={chatMessages}
                  chatInput={chatInput}
                  setChatInput={setChatInput}
                  sendChat={sendChat}
                />
              </>
            )}
          </div>
        </div>
      </main>
      <FloatingChatButton label="Chat bot" onClick={() => {
        setActiveTab('ai');
        setMobileView('detail');
      }} />

      <nav className="mobile-nav">
        <div className="mobile-nav-inner">
          <button className={`mnav-btn ${mobileView === 'list' ? 'active' : ''}`} onClick={() => setMobileView('list')}>
            <span className="mnav-icon">🗂️</span>
            <span className="mnav-label">Parcelet</span>
          </button>
          <button className={`mnav-btn ${mobileView === 'map' ? 'active' : ''}`} onClick={() => setMobileView('map')}>
            <span className="mnav-icon">🗺️</span>
            <span className="mnav-label">Harta</span>
          </button>
          <button className={`mnav-btn ${mobileView === 'detail' ? 'active' : ''}`} onClick={() => setMobileView('detail')}>
            <span className="mnav-icon">📋</span>
            <span className="mnav-label">Detajet</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const layersRef = useRef({
    landuse: null,
    adminareas: null,
    water: null,
    regional: null,
    parcels: null
  });
  const [selectedId, setSelectedId] = useState(() => detailedParcels.find((parcel) => parcel.id === SAMPLE_PARCEL_ID)?.id ?? detailedParcels[0]?.id ?? null);
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
  const [adminMobileView, setAdminMobileView] = useState('map');
  const [adminAiOpen, setAdminAiOpen] = useState(false);
  const [adminAiStage, setAdminAiStage] = useState('Tap to start analysis');
  const [adminAiProgress, setAdminAiProgress] = useState(0);
  const adminAiTimersRef = useRef([]);
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(VIEW_MODE_STORAGE_KEY) || 'demo';
    } catch (error) {
      return 'demo';
    }
  });
  const [demoPage, setDemoPage] = useState(() => {
    try {
      return localStorage.getItem(DEMO_PAGE_STORAGE_KEY) || 'login';
    } catch (error) {
      return 'login';
    }
  });
  const [authUser, setAuthUser] = useState(() => {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  });
  const visibleParcels = useMemo(() => {
    if (authUser?.role === 'farmer') {
      return detailedParcels.filter((parcel) => parcel.owner === authUser.name);
    }
    return detailedParcels;
  }, [authUser]);
  const filteredParcels = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return visibleParcels.filter((parcel) => {
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
  }, [filterMode, searchTerm, visibleParcels]);
  const selectedParcel = useMemo(() => {
    return filteredParcels.find((parcel) => parcel.id === selectedId) || visibleParcels.find((parcel) => parcel.id === selectedId) || filteredParcels[0] || visibleParcels[0] || detailedParcels[0];
  }, [filteredParcels, selectedId, visibleParcels]);
  const parcelData = useMemo(() => parcelFeatureCollection(filteredParcels, selectedId), [filteredParcels, selectedId]);
  const isDetailView = zoom >= DETAIL_ZOOM;
  const stats = useMemo(() => municipalityStats(detailedParcels), []);
  const filteredRegionalSummary = useMemo(() => {
    if (authUser?.role === 'farmer') return EMPTY_COLLECTION;
    if (filterMode === 'all') return regionalSummaryData;
    const statusForMode = filterMode === 'risk'
      ? 'Critical Alert'
      : filterMode === 'stress'
        ? 'Watch'
        : 'Healthy';
    return {
      ...regionalSummaryData,
      features: regionalSummaryData.features.filter((feature) => feature?.properties?.status === statusForMode)
    };
  }, [authUser, filterMode]);
  const summary = useMemo(() => {
    const critical = detailedParcels.filter((parcel) => parcel.status === 'Critical Alert').length;
    const avgHealth = Math.round(detailedParcels.reduce((sum, parcel) => sum + parcel.landHealthScore, 0) / detailedParcels.length);
    const loss = detailedParcels.reduce((sum, parcel) => sum + parcel.projectedLoss, 0);
    return { critical, avgHealth, loss };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch (error) {
      // Ignore persistence errors.
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(DEMO_PAGE_STORAGE_KEY, demoPage);
    } catch (error) {
      // Ignore persistence errors.
    }
  }, [demoPage]);

  useEffect(() => {
    if (!filteredParcels.length) return;
    if (!selectedId || !filteredParcels.some((parcel) => parcel.id === selectedId)) {
      setSelectedId(filteredParcels[0].id);
    }
  }, [filteredParcels, selectedId]);

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
    if (authUser?.role === 'farmer' && visibleParcels.length) {
      const bounds = L.latLngBounds(
        visibleParcels.flatMap((parcel) => parcel.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]))
      );
      mapRef.current?.fitBounds(bounds, { padding: [36, 36], duration: 700 });
      return;
    }
    mapRef.current?.fitBounds(KOSOVO_LAT_LNG_BOUNDS, { padding: 36, duration: 700 });
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

  const handleAuth = (user) => {
    const payload = {
      nid: user.nid,
      name: user.name,
      role: user.role,
      municipality: user.municipality
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    setAuthUser(payload);
    setViewMode('app');

    if (payload.role === 'farmer') {
      const firstOwnedParcel = detailedParcels.find((parcel) => parcel.owner === payload.name);
      if (firstOwnedParcel) {
        setSelectedId(firstOwnedParcel.id);
      }
    }
  };

  const handleDemoRole = (role) => {
    const account = role === 'farmer' ? DEMO_ACCOUNTS['1234567890'] : DEMO_ACCOUNTS.admin;
    handleAuth(account);
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuthUser(null);
  };

  const clearAdminAiTimers = () => {
    adminAiTimersRef.current.forEach((timer) => clearTimeout(timer));
    adminAiTimersRef.current = [];
  };

  const runAdminAi = () => {
    clearAdminAiTimers();
    setAdminAiOpen(true);
    setAdminAiStage('Scanning parcel clusters...');
    setAdminAiProgress(18);

    adminAiTimersRef.current.push(
      setTimeout(() => {
        setAdminAiStage('Comparing satellite and farmer declarations...');
        setAdminAiProgress(56);
      }, 700)
    );

    adminAiTimersRef.current.push(
      setTimeout(() => {
        setAdminAiStage('Generating outreach and inspection priorities...');
        setAdminAiProgress(86);
      }, 1400)
    );

    adminAiTimersRef.current.push(
      setTimeout(() => {
        setAdminAiStage('Analysis ready');
        setAdminAiProgress(100);
      }, 2200)
    );
  };

  useEffect(() => () => clearAdminAiTimers(), []);

  const syncParcelPanel = (parcel) => {
    const map = mapRef.current;
    if (!map) return;

    const panelContent = buildParcelPanel(parcel);
    if (!panelContent) {
      popupRef.current?.remove();
      popupRef.current = null;
      return;
    }

    if (!popupRef.current) {
      popupRef.current = L.control({ position: 'bottomright' });
      popupRef.current.onAdd = () => {
        const container = L.DomUtil.create('div', 'toka-parcel-panel');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        return container;
      };
      popupRef.current.addTo(map);
    }

    const container = popupRef.current.getContainer();
    if (container) {
      container.innerHTML = panelContent;
    }
  };

  const focusParcel = (parcel, options = {}) => {
    if (!parcel) return;

    const bounds = parcelBounds(parcel);
    setSelectedId(parcel.id);
    if (bounds) {
      mapRef.current?.fitBounds(bounds, {
        padding: options.padding ?? [36, 36],
        duration: options.duration ?? 700
      });
    }

    if (options.openPopup === false) {
      popupRef.current?.remove();
      popupRef.current = null;
      return;
    }

    syncParcelPanel(parcel);
  };

  useEffect(() => {
    if (!mapContainerRef.current) return undefined;
    if (mapRef.current) return undefined;

    const leafletBounds = [
      [kosovoBounds[0][1], kosovoBounds[0][0]],
      [kosovoBounds[1][1], kosovoBounds[1][0]]
    ];
    const kosovoLatLngBounds = geoJsonBoundsToLatLng(kosovoBounds);

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomSnap: 0.25,
      minZoom: 7.3,
      maxZoom: 16.8,
      maxBounds: KOSOVO_LAT_LNG_BOUNDS,
      maxBoundsViscosity: 1.0
    });

    mapRef.current = map;
    map.fitBounds(leafletBounds, { padding: [32, 32], animate: false });

    const clampToKosovo = () => {
      const minZoom = map.getBoundsZoom(kosovoLatLngBounds, false);
      map.setMinZoom(minZoom);
      if (map.getZoom() < minZoom) {
        map.setZoom(minZoom);
      }
    };

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      opacity: 1,
      noWrap: true,
      attribution: '&copy; Esri'
    }).addTo(map);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });

    const syncZoomState = () => {
      setZoom(Number(map.getZoom().toFixed(2)));
    };

    const getShowDetail = () => map.getZoom() >= DETAIL_ZOOM;

    const landuseStyle = (feature) => ({
      color: feature?.properties?.category === 'woodland'
        ? '#132a13'
        : feature?.properties?.category === 'built'
          ? '#4b1b07'
          : feature?.properties?.category === 'tree_crop'
            ? '#48acf0'
            : '#1f923b',
      weight: 0.7,
      fillColor: feature?.properties?.category === 'built'
        ? '#4b1b07'
        : feature?.properties?.category === 'tree_crop'
          ? '#48acf0'
          : '#1f923b',
      fillOpacity: 0.22,
      opacity: 0.52
    });

    const regionalStyle = (feature) => ({
      color: 'rgba(255,255,255,0.42)',
      weight: 0.8,
      fillColor: feature?.properties?.color || '#1f923b',
      fillOpacity: 0.34,
      opacity: 0.65
    });

    const parcelStyle = (feature) => ({
      color: feature?.properties?.selected ? '#132a13' : '#f4fcd9',
      weight: feature?.properties?.selected ? 3 : 1.4,
      fillColor: feature?.properties?.color || '#1f923b',
      fillOpacity: feature?.properties?.selected ? 0.30 : 0.16
    });

    const showParcelPopup = (parcel) => {
      if (!parcel) return;

      syncParcelPanel(parcel);
    };

    const handleResize = () => {
      map.invalidateSize();
      clampToKosovo();
    };

    resizeObserver.observe(mapContainerRef.current);

    const canvasRenderer = L.canvas({ padding: 0.5 });

    const landuseLayer = L.geoJSON(EMPTY_COLLECTION, {
      style: landuseStyle,
      interactive: false
    });
    const adminareasLayer = L.geoJSON(EMPTY_COLLECTION, {
      style: {
        color: '#0f2a13',
        weight: 2.2,
        opacity: 1,
        fillOpacity: 0
      },
      interactive: false
    });
    const waterLayer = L.geoJSON(EMPTY_COLLECTION, {
      style: {
        color: '#48acf0',
        weight: 0.8,
        fillColor: '#48acf0',
        fillOpacity: 0.2,
        opacity: 0.65
      },
      interactive: false
    });
    const outsideMaskLayer = L.polygon([], {
      color: 'transparent',
      weight: 0,
      fillColor: '#d9ecd0',
      fillOpacity: 0.48,
      interactive: false
    });
    const regionalLayer = L.geoJSON(filteredRegionalSummary, {
      renderer: canvasRenderer,
      style: regionalStyle,
      onEachFeature: (feature, layer) => {
        layer.on({
          click: () => {
            const parcel = findParcel(feature?.properties?.detailId);
            if (!parcel) return;
            focusParcel(parcel, { padding: [28, 28] });
          },
          mouseover: () => {
            map.getContainer().style.cursor = 'pointer';
          },
          mouseout: () => {
            map.getContainer().style.cursor = '';
          }
        });
      }
    });
    const parcelsLayer = L.geoJSON(parcelData, {
      renderer: canvasRenderer,
      style: parcelStyle,
      onEachFeature: (feature, layer) => {
        layer.on({
          click: () => {
            const parcel = findParcel(feature?.properties?.id);
            if (!parcel) return;
            focusParcel(parcel);
          },
          mouseover: () => {
            map.getContainer().style.cursor = 'pointer';
          },
          mouseout: () => {
            map.getContainer().style.cursor = '';
          }
        });
      }
    });

    layersRef.current = {
      landuse: landuseLayer,
      adminareas: adminareasLayer,
      water: waterLayer,
      outsideMask: outsideMaskLayer,
      regional: regionalLayer,
      parcels: parcelsLayer
    };

    const syncLayerVisibility = () => {
      const { landuse, adminareas, water, outsideMask, regional, parcels } = layersRef.current;
      if (!landuse || !adminareas || !water || !outsideMask || !regional || !parcels) return;

      if (!map.hasLayer(landuse)) landuse.addTo(map);
      if (!map.hasLayer(water)) water.addTo(map);
      if (!map.hasLayer(outsideMask)) outsideMask.addTo(map);
      if (!map.hasLayer(adminareas)) adminareas.addTo(map);
      if (map.hasLayer(regional)) map.removeLayer(regional);
      if (!map.hasLayer(parcels)) parcels.addTo(map);
      outsideMask.bringToFront();
      adminareas.bringToFront();
      parcels.bringToFront();
    };

    const loadLayers = async () => {
      try {
        const [landuse, adminareas, water] = await Promise.all([
          fetch('/data/kosovo-landuse.geojson').then((response) => response.json()),
          fetch('/data/kosovo-adminareas.geojson').then((response) => response.json()),
          fetch('/data/kosovo-water.geojson').then((response) => response.json())
        ]);

        landuseLayer.clearLayers().addData(landuse);
        waterLayer.clearLayers().addData(water);

        const kosovoFeature = adminareas.features?.find((feature) => String(feature?.properties?.name || '').includes('Kosova / Kosovo'));
        if (kosovoFeature) {
          adminareasLayer.clearLayers().addData(kosovoFeature);
          outsideMaskLayer.setLatLngs(buildKosovoOutsideMask(kosovoFeature));
        }

        setOsmCounts({
          landuse: landuse.features?.length ?? 0,
          adminareas: adminareas.features?.length ?? 0,
          water: water.features?.length ?? 0
        });
        setOsmStatus('ready');
      } catch (error) {
        setOsmStatus('unavailable');
      } finally {
        map.addLayer(landuseLayer);
        map.addLayer(waterLayer);
        map.addLayer(outsideMaskLayer);
        map.addLayer(adminareasLayer);
        outsideMaskLayer.bringToFront();
        adminareasLayer.bringToFront();
        syncLayerVisibility();
        clampToKosovo();
        syncZoomState();
        setMapReady(true);
      }
    };

    loadLayers();

    const syncVisibilityAndZoom = () => {
      syncZoomState();
      syncLayerVisibility();
    };

    map.on('zoomend', syncVisibilityAndZoom);
    map.on('moveend', clampToKosovo);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      popupRef.current?.remove();
      map.off('zoomend', syncVisibilityAndZoom);
      map.off('moveend', clampToKosovo);
      map.remove();
      mapRef.current = null;
      popupRef.current = null;
      layersRef.current = {
        landuse: null,
        adminareas: null,
        water: null,
        outsideMask: null,
        regional: null,
        parcels: null
      };
    };
  }, [authUser, visibleParcels]);

  useEffect(() => {
    const map = mapRef.current;
    const { regional, parcels } = layersRef.current;
    if (!map || !regional || !parcels) return;

    regional.clearLayers();
    regional.addData(filteredRegionalSummary);

    parcels.clearLayers();
    parcels.addData(parcelData);

    if (selectedParcel) {
      syncParcelPanel(selectedParcel);
    } else {
      popupRef.current?.remove();
      popupRef.current = null;
    }
  }, [authUser, filteredRegionalSummary, parcelData, selectedParcel]);

  if (viewMode === 'demo') {
    return (
      <>
        <div className="app-mode-switch-shell">
          <AppModeSwitch viewMode={viewMode} setViewMode={setViewMode} />
        </div>
        <HtmlDemoView
          demoPage={demoPage}
          setDemoPage={setDemoPage}
        />
      </>
    );
  }

  if (!authUser) {
    return (
      <>
        <AuthView onAuth={handleAuth} viewMode={viewMode} setViewMode={setViewMode} />
      </>
    );
  }

  if (authUser.role === 'farmer') {
    return (
      <>
        <div className="app-mode-switch-shell app-switch-cluster">
          <AppModeSwitch viewMode={viewMode} setViewMode={setViewMode} />
          <DemoRoleSwitch authUser={authUser} onSelectRole={handleDemoRole} />
        </div>
        <FarmerDashboard
          authUser={authUser}
          selectedParcel={selectedParcel}
          setSelectedId={setSelectedId}
          focusParcel={focusParcel}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filteredParcels={filteredParcels}
          filterMode={filterMode}
          setFilterMode={setFilterMode}
          mapContainerRef={mapContainerRef}
          mapReady={mapReady}
          osmStatus={osmStatus}
          osmCounts={osmCounts}
          zoom={zoom}
          isDetailView={isDetailView}
          handleLogout={handleLogout}
          chatMessages={chatMessages}
          chatInput={chatInput}
          setChatInput={setChatInput}
          sendChat={sendChat}
        />
      </>
    );
  }

  return (
    <>
      <div className="app-mode-switch-shell app-switch-cluster">
        <AppModeSwitch viewMode={viewMode} setViewMode={setViewMode} />
        <DemoRoleSwitch authUser={authUser} onSelectRole={handleDemoRole} />
      </div>
      <div className={`app-shell admin-shell ${adminMobileView === 'detail' ? 'admin-detail-open' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-hex">
            <BrandLogo />
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
            <div className="admin-av">{(authUser?.name || adminUser.name).slice(0, 2).toUpperCase()}</div>
            <span>{authUser?.name || adminUser.name}</span>
          </div>
          <button className="toka-top-btn" type="button" onClick={handleLogout}>
            Dil
          </button>
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
              <div className="sv">{regionalSummaryData.features.length.toLocaleString('de-DE')}</div>
              <div className="sl">Visible admin hexes</div>
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
                  focusParcel(parcel);
                  setSidebarOpen(false);
                  setAdminMobileView('detail');
                  setActiveDetailTab('overview');
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    focusParcel(parcel);
                    setSidebarOpen(false);
                    setAdminMobileView('detail');
                    setActiveDetailTab('overview');
                  }
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

          <div className="admin-ai-filter">
            <button
              className={`aif-orb ${adminAiOpen ? 'open' : ''}`}
              type="button"
              onClick={() => {
                runAdminAi();
                setFilterMode('risk');
              }}
              aria-expanded={adminAiOpen}
            >
              <span className="aif-orb-core">
                <span className={`aif-orb-ring ${adminAiProgress >= 100 ? 'done' : ''}`} />
                <span className="aif-orb-icon">AI</span>
              </span>
              <span className="aif-orb-copy">
                <span className="aif-title">Agriculture AI</span>
                <span className="aif-sub">{adminAiStage}</span>
                <span className="aif-progress">
                  <span style={{ width: `${adminAiProgress}%` }} />
                </span>
                <span className="aif-hint">Analyzing risk clusters and outreach priority.</span>
              </span>
            </button>
          </div>

          <button className="map-drawer-btn" type="button" onClick={() => setAdminMobileView((value) => (value === 'detail' ? 'map' : 'detail'))}>
            {adminMobileView === 'detail' ? 'Map' : 'Detajet'}
          </button>

          <div ref={mapContainerRef} id="leaflet-map" />

          {!mapReady && (
            <div className="detail-loading map-loading">
              <div>Loading map</div>
            </div>
          )}

          <div className="map-muni-tooltip" id="muni-tooltip">
            {isDetailView ? 'Synthetic parcel detail view' : 'Hex land-use overview'}
          </div>
        </section>

        <div className={`bottom-panels ${adminMobileView === 'detail' ? 'mobile-visible' : ''}`}>
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
                  <div className="dp-actions-row">
                    <button className="dp-ai-btn" type="button" onClick={() => setActiveDetailTab('advisor')}>
                      🤖 Këshilltari AI
                    </button>
                    <button className="dp-link-btn" type="button" onClick={() => setActiveDetailTab('advisor')}>
                      Open chatbot
                    </button>
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
      <FloatingChatButton label="Chat bot" onClick={() => {
        setActiveDetailTab('advisor');
        setAdminMobileView('detail');
      }} />
      <AdminMobileNav
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        adminMobileView={adminMobileView}
        setAdminMobileView={setAdminMobileView}
        activeDetailTab={activeDetailTab}
        setActiveDetailTab={setActiveDetailTab}
      />
      </div>
    </>
  );
}
