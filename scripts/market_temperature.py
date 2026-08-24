"""
市场情绪温度计算法 — v2.0.7z(用户最新算法)
5 个最能反映 A 股短线情绪的维度,基础分 50 + 各维度得分 = 最终温度(0-100)。

维度1:涨跌停对比(30% 权重) - 涨停/跌停比例 → +15/+10/+5/0/-15
维度2:连板高度(20% 权重) - 最高连板数   → +10/+8/+5/0/-10
维度3:炸板率(20% 权重)   - 炸板/(涨停+炸板) → +10/+5/-5/-10
维度4:昨日涨停今日表现(20% 权重) - 昨日涨停股今日平均涨幅 → +10/+5/-5/-10
维度5:晋级率(10% 权重)   - 今日N板/昨日(N-1)板 → +5/+2/-5

"权重" 用于说明各维度重要程度,分数计算时**直接相加**(不加权乘)。
最大正向 = 50+15+10+10+10+5 = 100,最大负向 = 50-15-10-10-10-5 = 0,完美对齐 0-100。

数据缺失:统一按 0 分(中性)。
"""

# 维度说明(用于前端展示,不影响计算)
DIMENSION_WEIGHTS = {
    'limit_ratio':  '涨跌停对比',
    'max_boards':   '连板高度',
    'broken_rate':  '炸板率',
    'yest_perf':    '昨日涨停今日',
    'promote_rate': '晋级率',
}

BASE_SCORE = 50

# 状态标签区间(温度 → 名称,描述)
STATUS_MAP = [
    (20,  '绝对冰点',  '退潮末期,试错期'),
    (40,  '低温分歧',  '情绪修复,接力谨慎'),
    (60,  '常温震荡',  '无明显主线,轮动快'),
    (80,  '高温一致',  '主升浪,赚钱效应强'),
    (100, '极度沸点',  '高潮,随时面临退潮分歧'),
]


def calculate_market_temperature(data: dict) -> dict:
    """
    5 维度加权计算 0-100 情绪温度。
    输入字段(全可空,缺失按 0 处理):
      limit_up_count, limit_down_count, max_consecutive_boards,
      broken_limit_count, yesterday_limit_avg_change,
      yesterday_n1_count, today_n2_count
    输出:temperature, status, statusDesc, details, dimension_scores
    """
    score = float(BASE_SCORE)

    # ===== 1. 涨跌停对比(+15 ~ -15) =====
    limit_up = max(0, int(data.get('limit_up_count') or 0))
    limit_down = max(0, int(data.get('limit_down_count') or 0))
    ratio = limit_up / max(limit_down, 1)
    if ratio > 10:
        s1 = 15
    elif ratio > 5:
        s1 = 10
    elif ratio > 2:
        s1 = 5
    elif ratio >= 1:
        s1 = 0
    else:
        s1 = -15
    score += s1

    # ===== 2. 连板高度(+10 ~ -10) =====
    boards = max(0, int(data.get('max_consecutive_boards') or 0))
    if boards >= 7:
        s2 = 10
    elif boards >= 5:
        s2 = 8
    elif boards >= 4:
        s2 = 5
    elif boards >= 3:
        s2 = 0
    else:
        s2 = -10
    score += s2

    # ===== 3. 炸板率(+10 ~ -10) =====
    broken = max(0, int(data.get('broken_limit_count') or 0))
    if limit_up + broken > 0:
        broken_rate = broken / (limit_up + broken)
        if broken_rate < 0.15:
            s3 = 10
        elif broken_rate < 0.30:
            s3 = 5
        elif broken_rate < 0.50:
            s3 = -5
        else:
            s3 = -10
    else:
        broken_rate = 0
        s3 = 0  # 无数据按中性
    score += s3

    # ===== 4. 昨日涨停今日表现(+10 ~ -10) =====
    # 缺失按 0 分;avg=0 时归到 "0-3%" → +5
    yest_avg_raw = data.get('yesterday_limit_avg_change')
    if yest_avg_raw is None or (isinstance(yest_avg_raw, (int, float)) and yest_avg_raw == 0 and not data.get('yesterday_limit_avg_change_provided')):
        # 真无数据
        avg = None
        s4 = 0
    else:
        avg = float(yest_avg_raw)
        if avg > 3:
            s4 = 10
        elif avg >= 0:    # 0 ~ 3% 区间
            s4 = 5
        elif avg > -2:    # -2% ~ 0% 区间
            s4 = -5
        else:             # < -2%
            s4 = -10
    score += s4

    # ===== 5. 晋级率(+5 ~ -5) =====
    yest_n1 = max(0, int(data.get('yesterday_n1_count') or 0))
    today_n2 = max(0, int(data.get('today_n2_count') or 0))
    if yest_n1 > 0:
        promote_rate = today_n2 / yest_n1
        if promote_rate > 0.5:
            s5 = 5
        elif promote_rate >= 0.3:
            s5 = 2
        else:
            s5 = -5
    else:
        promote_rate = 0
        s5 = 0
    score += s5

    # 限制 0-100
    final = max(0, min(100, int(round(score))))

    # 状态标签
    status, status_desc = '常温震荡', '中性'
    for threshold, name, desc in STATUS_MAP:
        if final <= threshold:
            status, status_desc = name, desc
            break

    return {
        'temperature': final,
        'status': status,
        'statusDesc': status_desc,
        'details': {
            'limit_up': limit_up,
            'limit_down': limit_down,
            'max_boards': boards,
            'broken_rate': f'{broken_rate*100:.0f}%',
            'broken_count': broken,
            'yest_perf': f'{avg:+.1f}%' if avg is not None else '无数据',
            'yest_perf_value': avg if avg is not None else 0,
            'promote_rate': f'{promote_rate*100:.0f}%' if yest_n1 > 0 else '无数据',
            'promote_rate_value': promote_rate if yest_n1 > 0 else 0,
            'limit_ratio': f'{ratio:.1f}' if limit_down > 0 else f'{limit_up}/0',
        },
        'dimension_scores': {
            '涨跌停对比': s1,
            '连板高度': s2,
            '炸板率': s3,
            '昨日涨停今日': s4,
            '晋级率': s5,
        },
    }


# ============================================================
# CLI 测试 — 用 user 给的测试数据
# ============================================================
if __name__ == '__main__':
    import json
    test_data = {
        'limit_up_count': 60,
        'limit_down_count': 5,
        'max_consecutive_boards': 5,
        'broken_limit_count': 10,
        'yesterday_limit_avg_change': 2.5,
        'yesterday_n1_count': 15,
        'today_n2_count': 4,
    }
    result = calculate_market_temperature(test_data)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    # 预期:50+15+8+10+5-5 = 83 → 极度沸点
    print(f"\n[预期] 50+15+8+10+5-5 = 83 → 极度沸点")
    print(f"[实际] {result['temperature']} → {result['status']}")
