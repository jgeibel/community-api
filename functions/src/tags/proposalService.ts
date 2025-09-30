import { TagProposalRepository, TagProposalRecord } from './proposalRepository';

const MIN_TOKEN_LENGTH = 4;
const MAX_PROPOSALS_PER_EVENT = 10;

export const THEME_STOP_WORDS = new Set([
  'the','and','with','from','this','that','your','into','have','will','each','them','they','their','about','after',
  'before','during','event','events','community','local','group','meeting','meet','meetup','club','class','classes',
  'session','sessions','workshop','workshops','seminar','seminars','introduction','intro','series','night','day',
  'week','weekly','month','monthly','open','house','city','county','state','public','free','join','learn','learning',
  'skills','skill','family','families','kids','youth','adult','adults','beginner','beginners','advanced','general',
  'center','centre','campus','camp','program','programs','season','seasonal','festival','fest','market','gathering',
  'fun','games','game','activity','activities','support','supporting','volunteer','volunteers','drive','drives',
  'classroom','grade','grades','school','schools','career','careers','town','citywide','regional','morning','evening',
  'afternoon','night','monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february',
  'march','april','may','june','july','august','september','october','november','december','am','pm','zoom','hybrid',
  'in-person','online','virtual','hosted','hosting','feature','featuring','special','celebration','celebrate','music',
  'food','foods','drink','drinks','network','networking','pop','up','pop-up','popups','love','support','history',
  'cultural','culture','arts','art','artistic','craft','crafts','create','creative','creativity','performance','perform',
  'performing','show','shows','showcase','experience','experiences','talk','talks','speaker','speakers','panel',
  'panels','discussion','discussions','forum','forums','story','stories','storytelling','book','books','reading',
  'readings','library','libraries','celebrations','festival','festivals','practice','practices','individuals','years',
  'year','graders','grade','buck','park','parks','teacher','teachers','instructor','instructors','nd-3rd','jd',
  'level','levels','field','fields','behind','elementary','ages',
  'mondays','tuesdays','wednesdays','thursdays','fridays','saturdays','sundays','chelsea','moss','jeff','ivona','hiba'
]);

const ALLOWED_TITLE_CASE = new Set([
  'adult','adults','family','families','kids','youth','teens','teen','drop-in','drop','creative','modern','movement',
  'martial','ultimate','frisbee','volleyball','softball','baseball','soccer','cooking','yoga','ballet','tap','music',
  'arts','wellness','dance','basketball','pickleball','hiking','outdoors','fitness','running','walking'
]);

export interface EventTagProposalContext {
  eventId: string;
  sourceId: string;
  sourceEventId?: string;
  title: string;
  description?: string;
  tags: string[];
}

export class TagProposalService {
  private readonly repository: TagProposalRepository;

  constructor(options?: { repository?: TagProposalRepository }) {
    this.repository = options?.repository ?? new TagProposalRepository();
  }

  async processEvent(context: EventTagProposalContext): Promise<string[]> {
    // Use the tags that were already classified by the LLM/classifier
    // instead of re-extracting individual words from the event text
    const inputTags = context.tags ?? [];
    const debugMode = process.env.ENABLE_CLASSIFICATION_DEBUG === 'true';

    if (debugMode) {
      console.log('[TAG_PROPOSAL_DEBUG] Processing event', {
        eventTitle: context.title,
        inputTags,
        tagCount: inputTags.length,
      });
    }

    if (inputTags.length === 0) {
      return [];
    }

    const tasks: Promise<void>[] = [];
    const emitted = new Set<string>();
    const seenThisEvent = new Set<string>();

    // Process each tag that came from the classifier
    for (const tag of inputTags.slice(0, MAX_PROPOSALS_PER_EVENT)) {
      const slug = slugify(tag);
      if (!slug) {
        if (debugMode) {
          console.log('[TAG_PROPOSAL_DEBUG] Skipped tag (failed slugify)', { tag });
        }
        continue;
      }

      if (!shouldKeepGeneratedSlug(slug)) {
        if (debugMode) {
          console.log('[TAG_PROPOSAL_DEBUG] Skipped tag (stop word)', { tag, slug });
        }
        continue;
      }

      if (!seenThisEvent.has(slug)) {
        // Format the label nicely (e.g., "community-gardening" -> "Community Gardening")
        const label = formatLabel(slug);

        const record: TagProposalRecord = {
          slug,
          label,
          eventId: context.eventId,
          sourceId: context.sourceId,
          sourceEventId: context.sourceEventId,
          eventTitle: context.title,
        };

        if (debugMode) {
          console.log('[TAG_PROPOSAL_DEBUG] Recording tag', { slug, label });
        }

        tasks.push(this.repository.recordOccurrence(record));
        seenThisEvent.add(slug);
        emitted.add(slug);
      }
    }

    if (tasks.length > 0) {
      const results = await Promise.allSettled(tasks);
      if (debugMode) {
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
          console.error('[TAG_PROPOSAL_DEBUG] Failed to record some proposals', {
            failureCount: failures.length,
            errors: failures.map(f => (f as PromiseRejectedResult).reason),
          });
        }
      }
    }

    if (debugMode) {
      console.log('[TAG_PROPOSAL_DEBUG] Completed', {
        eventTitle: context.title,
        emittedTags: Array.from(emitted),
      });
    }

    return Array.from(emitted);
  }
}
function formatLabel(token: string): string {
  return token
    .split('-')
    .map(part => part.length > 0 ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length >= MIN_TOKEN_LENGTH ? slug : '';
}

export function looksLikeProperName(token: string): boolean {
  if (token.length < MIN_TOKEN_LENGTH) {
    return false;
  }

  if (token.includes('-') || token.includes("'") || token.includes('’')) {
    const normalized = token.toLowerCase();
    return !ALLOWED_TITLE_CASE.has(normalized);
  }

  if (/^[A-Z][a-z]+$/.test(token)) {
    const normalized = token.toLowerCase();
    return !ALLOWED_TITLE_CASE.has(normalized);
  }

  if (/^[A-Z]{2,}$/.test(token)) {
    return true;
  }

  return false;
}

export function shouldKeepGeneratedSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !THEME_STOP_WORDS.has(normalized);
}
