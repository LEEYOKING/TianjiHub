import { COLOR_UP } from '../utils/format';

interface Props {
  title: string;
  extra?: React.ReactNode;
}

/** 区域标题:左侧红色竖条 + 黑色标题 */
export default function SectionTitle({ title, extra }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #EBEEF5',
        paddingBottom: 12,
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            width: 4,
            height: 18,
            background: COLOR_UP,
            borderRadius: 2,
            marginRight: 10,
          }}
        />
        <span style={{ fontSize: 18, fontWeight: 600, color: '#333' }}>{title}</span>
      </div>
      {extra && <div>{extra}</div>}
    </div>
  );
}
