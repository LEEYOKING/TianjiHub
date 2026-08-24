import { useEffect, useState, useRef, useMemo, createContext, useContext, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
// v2.0.7ff:按页面代码分割 — 首屏只 load Overview,其他页面 React.lazy 按路由 fetch
const Sector = lazy(() => import('./pages/Sector'));
const LimitUp = lazy(() => import('./pages/LimitUp'));
const LimitDown = lazy(() => import('./pages/LimitDown'));
const AnomalyStock = lazy(() => import('./pages/AnomalyStock'));
const DragonTiger = lazy(() => import('./pages/DragonTiger'));
const Surgery = lazy(() => import('./pages/Surgery'));
const PreScan = lazy(() => import('./pages/PreScan'));
const FirstBoard = lazy(() => import('./pages/FirstBoard'));
import { loadReportData, type ReportData } from './data/loader';
import { useLiveData, mergeLiveData, type LiveSnapshot } from './hooks/useLiveData';

// 全局 live context — PageHeader 通过它读 lastUpdatedAt
const LiveContext = createContext<LiveSnapshot>({
  indices: [], market: null, history: null, today: null, fetchedAt: 0,
} as unknown as LiveSnapshot);
export const useLive = () => useContext(LiveContext);

export default function App() {
  const [baseData, setBaseData] = useState<ReportData | null>(null);
  const [baseErr, setBaseErr] = useState<string | null>(null);
  // v2.0.7fv:L3 修 — 用 ref 跟踪 baseData 最新值,避免 useEffect 闭包问题
  // — 改前 setState in updater 违反 React 18 规则
  // — 改成 ref + setBaseData 同步写 ref
  const baseDataRef = useRef<ReportData | null>(null);
  // v2.0.7ee:传 baseData.meta.stockCodes 给 useLiveData — 拉真实 5,547 只 A 股腾讯 qt.gtimg.cn
  const live = useLiveData(true, baseData?.meta?.stockCodes);

  useEffect(() => {
    // v2.0.7o:fetch 失败时如果已有 baseData(后台标签页被节流),静默不显示错误页
    // v2.0.7fv:L3 修 — 用 ref 读最新 baseData(避免 useEffect 闭包 stale)
    const fetchData = () =>
      loadReportData(true)
        .then((d) => {
          baseDataRef.current = d;
          setBaseData(d);
          setBaseErr(null);
        })
        .catch((e) => {
          // 只在首次加载失败(baseData 还没设)时报错;后续失败静默(后台节流/网络抖动)
          if (baseDataRef.current === null) {
            setBaseErr(String(e?.message || e));
          }
        });
    fetchData();
    const reloadTimer = setInterval(fetchData, 60_000);
    return () => clearInterval(reloadTimer);
  }, []);

  const merged = useMemo(() => {
    if (!baseData) return null;
    return mergeLiveData(baseData, live);
  }, [baseData, live]);

  if (baseErr) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 480, padding: 24 }}>
          <h2 style={{ color: '#E60012', marginBottom: 12 }}>数据加载失败</h2>
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 6 }}>{baseErr}</p>
          <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 20 }}>可能原因:网络不稳定 / GitHub Pages 部署中 / 服务器异常</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px', fontSize: 14, fontWeight: 500,
              color: '#fff', background: '#1890ff', border: 'none', borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            🔄 重新加载
          </button>
        </div>
      </div>
    );
  }

  // v1.9.1 启动页文案 + loading 动画 + v2.0 粒子背景
  // v2.0.7dc-fix:盘后 useLiveData 不拉实时数据,isFirstLoad 永远 true → 加 isLiveMarket() 检查
  // 实际:盘后不卡启动页(因为本来就不应该等实时数据 — 走 baseData)
  // v2.0.7eb-fix:有 baseData 就显示主页面 — 不等 useLiveData 拉腾讯(28s)
  // — 之前 useLiveData 拉 fetchMarketSummary 28s 期间 splash 不消失,user 看到"卡在启动页"
  // — 修法:merged 有数据(从 baseData 来)就直接显示,实时数据后台拉
  if (!merged) {
    return (
      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: 'linear-gradient(180deg, #fafbff 0%, #f5f7fa 100%)',
        flexDirection: 'column', gap: 20, overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          {/* v2.0.7fw:启动页两行文案 → 替换为 brand-logo(算筹 + 天机枢),保留下方"进入中..."动效 */}
          <img src="/logo1.png" alt="天机枢" style={{ height: 110, width: 'auto' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#1890ff', fontWeight: 500 }}>A股每日复盘，正在进入您的天机枢...</span>
            <span className="loading-dots">
              <span /><span /><span />
            </span>
          </div>
        </div>
        <style>{`
          .loading-dots { display: inline-flex; gap: 4px; }
          .loading-dots span {
            width: 6px; height: 6px; border-radius: 50%; background: #1890ff;
            animation: dotBounce 1.2s infinite ease-in-out;
          }
          .loading-dots span:nth-child(1) { animation-delay: 0s; }
          .loading-dots span:nth-child(2) { animation-delay: 0.15s; }
          .loading-dots span:nth-child(3) { animation-delay: 0.3s; }
          @keyframes dotBounce {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
            40% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <LiveContext.Provider value={live}>
      <BrowserRouter>
        <Layout data={merged}>
          {/* v2.0.7ff:lazy 加载页面 fallback — 显示简单 loading,避免白屏 */}
          <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#86909C' }}>页面加载中…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<Overview data={merged} />} />
              <Route path="/sector" element={<Sector data={merged} />} />
              <Route path="/limit-up" element={<LimitUp data={merged} />} />
              <Route path="/limit-down" element={<LimitDown data={merged} />} />
              <Route path="/breakout" element={<AnomalyStock type="breakout" data={merged} />} />
              <Route path="/high-break" element={<AnomalyStock type="high-break" data={merged} />} />
              <Route path="/low-position" element={<AnomalyStock type="low-position" data={merged} />} />
              <Route path="/dragon-tiger" element={<DragonTiger data={merged} />} />
              <Route path="/surgery" element={<Surgery data={merged} />} />
              <Route path="/prescan" element={<PreScan />} />
              <Route path="/firstboard" element={<FirstBoard data={merged} />} />
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
    </LiveContext.Provider>
  );
}
