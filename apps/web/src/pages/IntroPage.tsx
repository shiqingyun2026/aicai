import { Link } from "react-router-dom";

export function IntroPage() {
  return (
    <section className="hero-grid">
      <div className="hero-copy card">
        <p className="eyebrow">阿财 V1</p>
        <h1>先定约束，再做筛选。</h1>
        <p className="lead">
          阿财不是荐股工具，它基于公开信息帮助用户缩窄研读方向。V1
          的重点是固定四种业务状态、来源链接可点击、证据不足宁可不给明确候选。
        </p>
        <div className="button-row">
          <Link className="primary-button" to="/form">
            开始填写条件
          </Link>
          <Link className="secondary-button" to="/result">
            查看结果页
          </Link>
        </div>
      </div>
      <aside className="card side-panel">
        <p className="eyebrow">V1 边界</p>
        <ul className="bullet-list">
          <li>介绍页、表单页、结果页三页独立</li>
          <li>Worker 负责规则、搜索编排和结果仲裁</li>
          <li>前端只负责输入、展示和交互反馈</li>
          <li>系统侧保留匿名问答记录，用户侧暂不开放历史页</li>
        </ul>
      </aside>
    </section>
  );
}
