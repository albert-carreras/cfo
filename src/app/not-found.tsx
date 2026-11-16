import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <h1>Not found</h1>
      <p className="lead">Nothing lives at this address. It may have been closed, or the link is wrong.</p>
      <Link href="/" className="btn">
        Back to the overview
      </Link>
    </main>
  );
}
