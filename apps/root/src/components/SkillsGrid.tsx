import { useState } from 'react';
import SkillModal from './SkillModal';

interface Skill {
  name: string;
  description?: string;
  selfAssessment?: string;
}

interface SkillsGridProps {
  skills: Skill[];
  locale: 'zh-tw' | 'en';
}

export default function SkillsGrid({ skills, locale }: SkillsGridProps) {
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const handleSkillClick = (skill: Skill) => {
    setSelectedSkill(skill);
  };

  const handleCloseModal = () => {
    setSelectedSkill(null);
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {skills.map((skill, index) => {
          const hasDetails =
            (skill.description && skill.description.trim()) ||
            (skill.selfAssessment && skill.selfAssessment.trim());

          return (
            <button
              key={index}
              onClick={() => handleSkillClick(skill)}
              className={`px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-center font-medium text-slate-700 dark:text-slate-300 transition-all duration-200 ${
                hasDetails
                  ? 'hover:bg-primary-50 dark:hover:bg-primary-950 hover:text-primary-700 dark:hover:text-primary-400 cursor-pointer hover:scale-105 hover:shadow-md'
                  : 'cursor-default'
              }`}
              disabled={!hasDetails}
              title={
                hasDetails
                  ? locale === 'zh-tw'
                    ? '點擊查看詳細資訊'
                    : 'Click to view details'
                  : undefined
              }
            >
              {skill.name}
            </button>
          );
        })}
      </div>

      <SkillModal
        isOpen={selectedSkill !== null}
        onClose={handleCloseModal}
        skill={selectedSkill}
        locale={locale}
      />
    </>
  );
}
