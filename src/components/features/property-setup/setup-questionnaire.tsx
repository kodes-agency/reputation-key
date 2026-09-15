import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
} from '#/components/ui/questionnaire'
import type { SetupMember } from './property-setup-contract'
import { SetupAiQuestion } from './setup-ai-question'
import { SetupLanguageQuestion } from './setup-language-question'
import { SetupManagerQuestion } from './setup-manager-question'
import {
  propertiesAskedAi,
  propertiesAskedLanguage,
  propertiesAskedManagers,
  type SetupAnswers,
  type SetupPropertyFacts,
} from './setup-plan'

type Props = Readonly<{
  facts: readonly SetupPropertyFacts[]
  members: ReadonlyMap<string, SetupMember>
  notice: MerchantAiNoticeDto
  answers: SetupAnswers
  onAnswersChange: (answers: SetupAnswers) => void
  onReview: () => void
}>

/**
 * The three questions of decision 2, one at a time. A question only lists the
 * properties that still need it; one no property needs is not asked at all.
 * Skipping leaves that step pending on the property's setup checklist.
 */
export function SetupQuestionnaire({
  facts,
  members,
  notice,
  answers,
  onAnswersChange,
  onReview,
}: Props) {
  const languageProperties = propertiesAskedLanguage(facts)
  const managerProperties = propertiesAskedManagers(facts)
  const aiProperties = propertiesAskedAi(facts)

  return (
    <Questionnaire
      aria-label="Set up properties"
      className="rounded-xl border bg-card p-4 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault()
        onReview()
      }}
    >
      <QuestionnaireProgress />
      {languageProperties.length > 0 ? (
        <SetupLanguageQuestion
          properties={languageProperties}
          answer={answers.language}
          disabled={false}
          onAnswerChange={(language) => onAnswersChange({ ...answers, language })}
        />
      ) : null}
      {managerProperties.length > 0 ? (
        <SetupManagerQuestion
          properties={managerProperties}
          members={members}
          answer={answers.managers}
          disabled={false}
          onAnswerChange={(managers) => onAnswersChange({ ...answers, managers })}
        />
      ) : null}
      {aiProperties.length > 0 ? (
        <SetupAiQuestion
          properties={aiProperties}
          notice={notice}
          answer={answers.ai}
          disabled={false}
          onAnswerChange={(ai) => onAnswersChange({ ...answers, ai })}
        />
      ) : null}
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip>Skip for now</QuestionnaireSkip>
        <QuestionnaireNext />
        <QuestionnaireSubmit>Review answers</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  )
}

export function setupQuestionCount(facts: readonly SetupPropertyFacts[]): number {
  return [
    propertiesAskedLanguage(facts),
    propertiesAskedManagers(facts),
    propertiesAskedAi(facts),
  ].filter((asked) => asked.length > 0).length
}
