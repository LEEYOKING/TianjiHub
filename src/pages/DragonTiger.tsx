import { useState, useMemo } from 'react';
import { Button, Space, Pagination } from 'antd';
import { LeftOutlined, ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { PageHeader } from './Overview';
import type { ReportData } from '../data/loader';
import { useLive } from '../App';
import { SmartDragonTigerCard, type InterpretedData } from '../components/SmartDragonTigerCard';

// 表格容器样式(用户 #18 / #6 反馈:全站圆角 14 + 新阴影)
const TABLE_STYLE = { background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 30px 5px rgba(0, 0, 0, 0.02)', border: '1px solid #E5E7EB', padding: 4 };

export default function DragonTiger({ data }: { data: ReportData }) {
  const idx = data.marketOverview;
  // v2.0.7ck:数据截至日期(从 dragonTiger 元信息拿,跟 baseData 实际跑出的日期一致)
  const dtMeta = data.dragonTiger;
  const sorted = useMemo(() => [...data.dragonTigerStocks].sort((a, b) => b.netBuy - a.netBuy), [data.dragonTigerStocks]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  if (selectedIdx !== null) {
    const stock = sorted[selectedIdx];
    return (
      <div>
        <PageHeader
          title="龙虎榜"
          tradeDateSlash={idx.tradeDateSlash} _originalTradeDate={idx.tradeDate}

          liveTag="智能解读"
          subtitle={`机构/游资买卖席位 · AI 解读(数据截至 ${dtMeta?.tradeDateSlash || idx.tradeDateSlash} 收盘)`}
          lastUpdatedAt={useLive().fetchedAt}
        />
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button type="primary" danger icon={<LeftOutlined />} onClick={() => setSelectedIdx(null)}>
              返回列表
            </Button>
            <Button icon={<ArrowLeftOutlined />} disabled={selectedIdx === 0} onClick={() => setSelectedIdx(Math.max(0, selectedIdx - 1))}>
              上一条
            </Button>
            <Button icon={<ArrowRightOutlined />} disabled={selectedIdx === sorted.length - 1} onClick={() => setSelectedIdx(Math.min(sorted.length - 1, selectedIdx + 1))}>
              下一条
            </Button>
          </Space>
        </div>
        {stock.interpreted && <SmartDragonTigerCard data={stock.interpreted as InterpretedData} />}
      </div>
    );
  }

  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  // 过滤有 interpreted 数据的股票
  const hasInterp = sorted.filter(s => s.interpreted).length;

  return (
    <div>
      <PageHeader
        title="龙虎榜"
        tradeDateSlash={idx.tradeDateSlash} _originalTradeDate={idx.tradeDate}

        liveTag="智能解读"
        subtitle={`AI 解读主力意图 · 共 ${sorted.length} 只${hasInterp < sorted.length ? `(${hasInterp} 只已解读)` : ''}（数据截至 ${dtMeta?.tradeDateSlash || idx.tradeDateSlash} 收盘）`}
        lastUpdatedAt={useLive().fetchedAt}
      />
      <div className="dt-grid">
        {sorted.length === 0 && (
          <div style={{ ...TABLE_STYLE, padding: 40, textAlign: 'center', color: '#86909C', fontSize: 13 }}>
            今日无龙虎榜数据(非交易日 / 数据未发布)
          </div>
        )}
        {sorted.length > 0 && paged.map((s, i) => {
          if (!s.interpreted) return null;
          return (
            <div key={s.code} onClick={() => setSelectedIdx((page - 1) * pageSize + i)} style={{ cursor: 'pointer' }}>
              <SmartDragonTigerCard data={s.interpreted as InterpretedData} />
            </div>
          );
        })}
      </div>
      {/* v2.0.7ac:3 列 → 2 列 → 1 列 响应式(原 900px 跳 1 列,现在加 1400px 跳 2 列) */}
      <style>{`
        .dt-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 1700px) {
          .dt-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 900px) {
          .dt-grid {
            grid-template-columns: 1fr !important;
          }
        }
        /* v2.0.7fd:移动端 768px — 紧凑(PC ≥ 769px 零影响) */
        @media (max-width: 768px) {
          .dt-grid { gap: 10px !important; }
        }
      `}</style>
      {sorted.length > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={sorted.length}
            onChange={setPage}
            showTotal={(t) => `第 ${page} / ${Math.ceil(t / pageSize)} 页 · 共 ${t} 条`}
          />
        </div>
      )}
    </div>
  );
}

