import { useState } from 'react';
import { Card, Table, Pagination } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import SectionTitle from '../components/SectionTitle';
import ColorText from '../components/ColorText';
import type { ReportData } from '../data/loader';
import type { QuoteData } from '../types';

export default function FirstBoard({ data }: { data: ReportData }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const list = data.firstBoardStocks;

  const columns: ColumnsType<QuoteData> = [
    { title: '代码', dataIndex: 'code', width: 90 },
    { title: '名称', dataIndex: 'name', width: 110, render: (v) => <a style={{ color: '#1890FF' }}>{v}</a> },
    { title: '所属行业', dataIndex: 'industry', width: 110 },
    { title: '涨跌幅', dataIndex: 'changePercent', width: 90, align: 'right', render: (v) => <ColorText value={v} mode="percent" withSign /> },
    { title: '换手率', dataIndex: 'turnoverRate', width: 80, align: 'right', render: (v) => (v ? v.toFixed(2) : '-') },
    { title: '成交额', dataIndex: 'turnover', width: 100, align: 'right', render: (v) => (v ? `${v.toFixed(2)}亿` : '-') },
    { title: '封板资金', dataIndex: 'sealedAmount', width: 100, align: 'right', render: (v) => (v ? `${v.toFixed(2)}亿` : '-') },
    { title: '炸板次数', dataIndex: 'bombedCount', width: 90, align: 'center' },
    { title: '首次封板时间', dataIndex: 'firstSealTime', width: 110, align: 'center' },
  ];

  return (
    <Card bodyStyle={{ padding: 24 }} style={{ borderRadius: 8 }}>
      <SectionTitle title={`首板梯队 (共 ${list.length} 只)`} />
      <Table
        rowKey="code"
        size="middle"
        columns={columns}
        dataSource={list.slice((page - 1) * pageSize, page * pageSize)}
        pagination={false}
        rowClassName={(_, i) => (i % 2 === 0 ? '' : 'row-alt')}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <span style={{ fontSize: 12, color: '#999' }}>
          第 {page} / {Math.max(1, Math.ceil(list.length / pageSize))} 页 · 共 {list.length} 条
        </span>
        <Pagination current={page} pageSize={pageSize} total={list.length} onChange={setPage} showSizeChanger={false} />
      </div>
    </Card>
  );
}
