import { Link } from 'react-router-dom';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="logo">
      <img src="/favicon.svg" alt="" width={30} height={30} />
      {!compact && (
        <span className="logo-text">
          Game<span>Trans</span>
        </span>
      )}
    </Link>
  );
}
