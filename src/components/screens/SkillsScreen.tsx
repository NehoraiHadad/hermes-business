import { GraduationCap, Lightbulb, Sparkles, WandSparkles } from 'lucide-react'
import { useCuratorInsights } from '../../hooks/useCuratorInsights'
import { hermesClient } from '../../lib/hermes-client'
import type { Skill } from '../../types'

export function SkillsScreen({ skills, onAdd }: { skills: Skill[]; onAdd: () => void }) {
  const learnedSkill = skills.find(skill => skill.provenance === 'agent')
  // Friendly Curator/learning notifications sourced from Hermes' official
  // endpoints (never fabricated); empty when the read is unavailable.
  const curatorNotifications = useCuratorInsights(true)
  return (
    <main className="content-screen">
      <section className="page-heading">
        <div>
          <h2>מה העוזר יודע</h2>
          <p>Skills הם תהליכים ויכולות ש־Hermes יודע להפעיל ולשפר.</p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <Sparkles size={17} /> למד תהליך חדש
        </button>
      </section>
      {curatorNotifications.length ? (
        <div className="curator-notes">
          {curatorNotifications.map(note => (
            <div key={note.id} className={`curator-note curator-note--${note.tone}`}>
              <span className="curator-note__icon">
                <GraduationCap size={18} />
              </span>
              <div>
                <strong>{note.title}</strong>
                {note.detail ? <p>{note.detail}</p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {learnedSkill ? (
        <div className="learning-banner">
          <span className="learning-banner__icon">
            <Lightbulb size={20} />
          </span>
          <div>
            <strong>העוזר למד תהליך חדש: {learnedSkill.name}</strong>
            <p>{learnedSkill.description || 'ה־Skill זמין גם בממשק המלא של Hermes.'}</p>
          </div>
          <button
            className="outline-button outline-button--small"
            onClick={() => void hermesClient.openFullSurface('desktop').catch(() => undefined)}
          >
            הצג ב־Hermes
          </button>
        </div>
      ) : null}
      <div className="skills-grid">
        {skills.map(skill => (
          <article className="skill-card" key={skill.name}>
            <div className="skill-card__top">
              <span className={`skill-icon skill-icon--${skill.provenance || 'bundled'}`}>
                {skill.provenance === 'agent' ? <Sparkles size={20} /> : <WandSparkles size={20} />}
              </span>
              <span className="state-label state-label--active">פעיל</span>
            </div>
            <h3>{skill.name}</h3>
            <p>{skill.description || 'יכולת זמינה לעוזר דרך Hermes.'}</p>
            <div className="skill-card__footer">
              <span>{skill.provenance === 'agent' ? 'נלמד על ידי העוזר' : 'מובנה ב־Hermes'}</span>
              <span>{skill.usage || 0} שימושים</span>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
