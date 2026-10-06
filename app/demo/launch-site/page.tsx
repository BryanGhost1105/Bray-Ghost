import type { Metadata } from 'next'
import { ArrowDown, ArrowRight, ArrowUpRight, BatteryCharging, Check, MapPin, Sun, Zap } from 'lucide-react'
import styles from './launch-site.module.css'

export const metadata: Metadata = {
  title: 'Solar launch-site concept | Bray-Ghost',
  description: 'A fictional, illustrative concept for a one-page local solar business website.',
  robots: { index: false, follow: false },
}

const services = [
  {
    number: '01',
    title: 'Home solar',
    description: 'A considered setup for the way your household uses power throughout the day.',
    icon: Sun,
  },
  {
    number: '02',
    title: 'Business backup',
    description: 'Keep essential equipment and everyday operations in view when planning backup.',
    icon: BatteryCharging,
  },
  {
    number: '03',
    title: 'Support & upkeep',
    description: 'A clear route to ask about system checks, maintenance, or an existing installation.',
    icon: Zap,
  },
]

const steps = [
  ['01', 'Tell us what matters', 'Share the appliances, working hours, and priorities you want a system to support.'],
  ['02', 'Review an approach', 'Discuss a proposed setup and the assumptions behind it before deciding anything.'],
  ['03', 'Choose your next step', 'Ask questions, request a written scope, or take time to compare your options.'],
]

function PanelIllustration() {
  return (
    <div className={styles.illustration} aria-label="Illustration of a solar panel and battery system" role="img">
      <div className={styles.sunOrb} />
      <div className={`${styles.orbit} ${styles.orbitOne}`} />
      <div className={`${styles.orbit} ${styles.orbitTwo}`} />
      <div className={styles.panelGroup}>
        <div className={styles.panelTop}>
          {Array.from({ length: 12 }, (_, index) => <span key={index} />)}
        </div>
        <div className={styles.panelLeg} />
        <div className={styles.panelShadow} />
      </div>
      <div className={styles.batteryCard}>
        <span className={styles.batteryIcon}><BatteryCharging size={17} /></span>
        <span><b>Storage</b><small>Planned for your needs</small></span>
        <span className={styles.statusDot} />
      </div>
      <div className={styles.sunCard}>
        <Sun size={15} />
        <span>Designed around your day</span>
      </div>
      <span className={styles.illustrationLabel}>A clearer first conversation</span>
    </div>
  )
}

export default function LaunchSiteDemoPage() {
  return (
    <main className={styles.page}>
      <div className={styles.demoNotice}>
        <span className={styles.noticeMark} />
        <span>Concept preview</span>
        <span className={styles.noticeDivider}>/</span>
        <span>Fictional business, copy, and imagery. Not a real solar installer.</span>
      </div>

      <header className={styles.header}>
        <a href="#top" className={styles.brand} aria-label="Luma Field home">
          <span className={styles.brandIcon}><Sun size={18} strokeWidth={1.7} /></span>
          <span>LUMA<span className={styles.brandLight}>FIELD</span></span>
        </a>
        <nav className={styles.nav} aria-label="Main navigation">
          <a href="#services">Services</a>
          <a href="#process">How it works</a>
          <a href="#about">About</a>
        </nav>
        <a className={styles.headerCta} href="#contact">Start a conversation <ArrowUpRight size={15} /></a>
      </header>

      <section id="top" className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> ENERGY, MADE PERSONAL <span className={styles.eyebrowPlace}><MapPin size={13} /> PORT HARCOURT</span></p>
          <h1>Power for the<br /><em>way you live.</em></h1>
          <p className={styles.heroLead}>Solar and backup systems, planned around your home or business, your priorities, and how you use power.</p>
          <div className={styles.heroActions}>
            <a href="#contact" className={styles.primaryButton}>Talk through your needs <ArrowRight size={16} /></a>
            <a href="#services" className={styles.textButton}>Explore services <ArrowDown size={15} /></a>
          </div>
          <div className={styles.heroFootnote}><span className={styles.pulseDot} /> A conversation first. A proposal only when it makes sense.</div>
        </div>
        <PanelIllustration />
        <div className={styles.heroIndex}><span>01</span><span className={styles.indexLine} /><span>04</span></div>
      </section>

      <section className={styles.trustStrip} aria-label="Service principles">
        <span>BUILT AROUND YOUR USE</span><span className={styles.stripDot} />
        <span>OPTIONS EXPLAINED CLEARLY</span><span className={styles.stripDot} />
        <span>NO ONE-SIZE-FITS-ALL QUOTES</span>
      </section>

      <section id="services" className={styles.section}>
        <div className={styles.sectionIntro}>
          <div><p className={styles.sectionLabel}>WHAT WE HELP WITH <span>01 / 03</span></p><h2>Start with the<br /><em>right questions.</em></h2></div>
          <p className={styles.sectionAside}>A solar project is easier to evaluate when the options, trade-offs, and next steps are clear. Tell us what you need to power; we’ll start there.</p>
        </div>
        <div className={styles.serviceGrid}>
          {services.map(({ number, title, description, icon: Icon }) => (
            <article className={styles.serviceCard} key={number}>
              <div className={styles.cardTop}><span>{number} / SERVICE</span><Icon size={20} strokeWidth={1.5} /></div>
              <h3>{title}</h3>
              <p>{description}</p>
              <a href="#contact" aria-label={`Ask about ${title}`}><ArrowUpRight size={17} /></a>
            </article>
          ))}
        </div>
      </section>

      <section id="process" className={styles.processSection}>
        <div className={styles.processHeading}>
          <p className={styles.sectionLabel}>A SIMPLE PLACE TO BEGIN <span>02 / 03</span></p>
          <h2>Understand first.<br /><em>Design second.</em></h2>
        </div>
        <div className={styles.steps}>
          {steps.map(([number, title, description]) => (
            <article className={styles.step} key={number}>
              <span className={styles.stepNumber}>{number}</span>
              <div><h3>{title}</h3><p>{description}</p></div>
              <Check size={17} className={styles.stepCheck} />
            </article>
          ))}
        </div>
      </section>

      <section id="about" className={styles.promiseSection}>
        <div className={styles.promiseMark}><Zap size={21} /></div>
        <div><p className={styles.sectionLabel}>A NOTE ON THE WORK</p><h2>Good advice starts<br />with <em>listening.</em></h2></div>
        <p className={styles.promiseCopy}>Every home and business uses power differently. This concept site shows how a small business can explain its services, set expectations, and give a visitor one clear next step—without promising savings or performance before understanding the actual project.</p>
      </section>

      <section id="contact" className={styles.contactSection}>
        <div className={styles.contactCard}>
          <div className={styles.contactGlow} />
          <div className={styles.contactCopy}>
            <p className={styles.sectionLabel}>YOUR PROJECT, YOUR QUESTIONS <span>03 / 03</span></p>
            <h2>Let’s find the<br /><em>right starting point.</em></h2>
            <p>Share what you’re looking to power and what you’ve already considered. We’ll take it one step at a time.</p>
            <a href="mailto:hello@example.com?subject=Solar%20project%20question" className={styles.contactButton}>Email the team <ArrowUpRight size={16} /></a>
            <p className={styles.contactDisclaimer}>Demo link only. Replace this placeholder with the client’s verified contact route before publishing.</p>
          </div>
          <div className={styles.contactDetails}>
            <div><span>01</span><p>Tell us about your space</p></div>
            <div><span>02</span><p>Ask anything, no pressure</p></div>
            <div><span>03</span><p>Decide when you’re ready</p></div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <a href="#top" className={styles.brand}><span className={styles.brandIcon}><Sun size={17} /></span><span>LUMA<span className={styles.brandLight}>FIELD</span></span></a>
        <span>ILLUSTRATIVE CONCEPT · FICTIONAL BUSINESS</span>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  )
}
