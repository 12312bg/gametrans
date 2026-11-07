import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const nav = useNavigate();
  return <Result status="404" title="页面不存在" subTitle="你访问的页面不存在或已被移除。" extra={<Button type="primary" onClick={() => nav('/')}>返回首页</Button>} />;
}
