/** Where "Enroll now" points. */
export const PROGRAM_URL = 'https://www.builtby.cv/100dayscourse';

/** Announcement strip pinned above the app. */
export function Banner() {
  return (
    <div className="banner" role="region" aria-label="Announcement">
      <p className="banner__text">
        <span className="banner__wave" aria-hidden="true">
          👋🏻
        </span>
        <span className="banner__shine">
          <span className="banner__long">Shai here! I just launched my Design Engineer Program.</span>
          <span className="banner__short">New: Design Engineer Program</span>
        </span>
        <a className="banner__link" href={PROGRAM_URL} target="_blank" rel="noreferrer">
          <span className="banner__long">Enroll now</span>
          <span className="banner__short">Enroll</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      </p>
    </div>
  );
}
