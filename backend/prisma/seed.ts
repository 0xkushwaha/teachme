/* Development seed. Idempotent: safe to run repeatedly. Never run against production. */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// Development-only credentials (documented in README "Seed accounts"). Override with SEED_PASSWORD.
const PASSWORD = process.env.SEED_PASSWORD ?? 'TeachMe-Dev-2026';

const categories = [
  { slug: 'mathematics', name: 'Mathematics', sortOrder: 1 },
  { slug: 'sciences', name: 'Sciences', sortOrder: 2 },
  { slug: 'technology', name: 'Technology', sortOrder: 3 },
  { slug: 'languages', name: 'Languages', sortOrder: 4 },
  { slug: 'humanities', name: 'Humanities & Commerce', sortOrder: 5 },
  { slug: 'test-prep', name: 'Test Preparation', sortOrder: 6 },
  { slug: 'music', name: 'Music', sortOrder: 7 },
];

const subjects = [
  { slug: 'algebra', name: 'Algebra', category: 'mathematics', description: 'Equations, functions, polynomials and the habits of reasoning that make the rest of mathematics click.' },
  { slug: 'calculus', name: 'Calculus', category: 'mathematics', description: 'Limits, derivatives and integrals — from first principles to board-exam and university problem sets.' },
  { slug: 'statistics', name: 'Statistics & Probability', category: 'mathematics', description: 'Distributions, inference and data intuition for school, college and the workplace.' },
  { slug: 'physics', name: 'Physics', category: 'sciences', description: 'Mechanics, electromagnetism, optics and modern physics with an emphasis on problem-solving.' },
  { slug: 'chemistry', name: 'Chemistry', category: 'sciences', description: 'Physical, organic and inorganic chemistry explained through reaction logic, not rote memory.' },
  { slug: 'biology', name: 'Biology', category: 'sciences', description: 'Cell biology, genetics, human physiology and ecology for CBSE, ICSE, IB and NEET.' },
  { slug: 'python-programming', name: 'Python Programming', category: 'technology', description: 'Write real programs: fundamentals, data structures, testing and small projects you can show.' },
  { slug: 'web-development', name: 'Web Development', category: 'technology', description: 'HTML, CSS, JavaScript and React — build and deploy responsive web apps.' },
  { slug: 'data-science', name: 'Data Science', category: 'technology', description: 'pandas, visualisation, and introductory machine learning on real datasets.' },
  { slug: 'english', name: 'English', category: 'languages', description: 'Reading comprehension, essay writing, grammar and confident spoken English.' },
  { slug: 'spanish', name: 'Spanish', category: 'languages', description: 'Conversational Spanish and DELE preparation with native-level guidance.' },
  { slug: 'hindi', name: 'Hindi', category: 'languages', description: 'Grammar, literature and writing for school curricula and heritage learners.' },
  { slug: 'economics', name: 'Economics', category: 'humanities', description: 'Micro and macroeconomics, graphs and case analysis for Class 11-12 and undergraduates.' },
  { slug: 'accountancy', name: 'Accountancy', category: 'humanities', description: 'Journal entries to financial statements, partnership and company accounts.' },
  { slug: 'jee-preparation', name: 'JEE Preparation', category: 'test-prep', description: 'Structured JEE Main & Advanced practice with timed problem sets and error analysis.' },
  { slug: 'ielts', name: 'IELTS', category: 'test-prep', description: 'Band-focused preparation across Listening, Reading, Writing and Speaking.' },
  { slug: 'piano', name: 'Piano', category: 'music', description: 'Technique, sight-reading and theory for beginners through Trinity grade exams.' },
  { slug: 'guitar', name: 'Guitar', category: 'music', description: 'Acoustic and electric guitar: chords, rhythm, fingerstyle and songwriting.' },
];

type SeedTeacher = {
  email: string;
  name: string;
  headline: string;
  bio: string;
  years: number;
  languages: string[];
  timezone: string;
  durations: number[];
  buffer: number;
  qualifications: { title: string; institution: string; year?: number }[];
  subjects: { slug: string; rate: number; levels: string }[];
  /** [isoWeekday, startHH, endHH][] in the teacher's timezone */
  hours: [number, number, number][];
};

const teachers: SeedTeacher[] = [
  {
    email: 'meera.iyer@teachme.dev', name: 'Dr. Meera Iyer', timezone: 'Asia/Kolkata', years: 12, languages: ['English', 'Tamil', 'Hindi'],
    headline: 'Physics PhD who makes mechanics and electromagnetism intuitive',
    bio: 'I spent six years researching condensed-matter physics at IISc before realising that my favourite part of the week was the undergraduate tutorial I ran. Since then I have taught Class 11-12 physics and first-year university mechanics to more than 400 students. My sessions start with the picture in your head — free-body diagrams, field lines, energy bar charts — and only then move to equations. Expect worked examples, a short problem to try on your own, and honest feedback on where your reasoning slipped.',
    qualifications: [{ title: 'PhD, Physics', institution: 'Indian Institute of Science, Bengaluru', year: 2014 }, { title: 'M.Sc. Physics', institution: 'University of Madras', year: 2008 }],
    subjects: [{ slug: 'physics', rate: 1500_00, levels: 'Class 11-12, Undergraduate' }, { slug: 'jee-preparation', rate: 1800_00, levels: 'JEE Main & Advanced' }],
    durations: [60, 90], buffer: 15, hours: [[1, 17, 21], [2, 17, 21], [3, 17, 21], [4, 17, 21], [6, 9, 13]],
  },
  {
    email: 'arjun.mehta@teachme.dev', name: 'Arjun Mehta', timezone: 'Asia/Kolkata', years: 8, languages: ['English', 'Hindi', 'Gujarati'],
    headline: 'Calculus and algebra coach for board exams and JEE',
    bio: 'IIT Bombay graduate and full-time maths educator. I break each topic into the three or four ideas that actually matter, then drill them with progressively harder questions until they feel obvious. Students who work with me for a term typically stop fearing word problems and start enjoying proofs. I keep a shared notes document for every student so nothing we cover is ever lost.',
    qualifications: [{ title: 'B.Tech, Engineering Physics', institution: 'IIT Bombay', year: 2016 }],
    subjects: [{ slug: 'calculus', rate: 1200_00, levels: 'Class 11-12, JEE' }, { slug: 'algebra', rate: 900_00, levels: 'Class 8-12' }, { slug: 'jee-preparation', rate: 1500_00, levels: 'JEE Main' }],
    durations: [45, 60, 90], buffer: 10, hours: [[1, 7, 9], [1, 18, 22], [3, 18, 22], [5, 18, 22], [6, 10, 18], [7, 10, 14]],
  },
  {
    email: 'sana.qureshi@teachme.dev', name: 'Sana Qureshi', timezone: 'Asia/Kolkata', years: 9, languages: ['English', 'Hindi', 'Urdu'],
    headline: 'Organic chemistry without memorising — learn the mechanisms',
    bio: 'I taught chemistry at a Delhi senior secondary school for seven years and now tutor full time. Organic chemistry is a story about electrons looking for a better home; once you see that, reactions stop being a list to memorise. I prepare students for CBSE, ISC and NEET, and I share concise one-page summaries after every session.',
    qualifications: [{ title: 'M.Sc. Chemistry', institution: 'University of Delhi', year: 2014 }, { title: 'B.Ed.', institution: 'Jamia Millia Islamia', year: 2015 }],
    subjects: [{ slug: 'chemistry', rate: 1100_00, levels: 'Class 9-12, NEET' }],
    durations: [60], buffer: 10, hours: [[2, 16, 20], [4, 16, 20], [6, 10, 16], [7, 10, 13]],
  },
  {
    email: 'rohan.das@teachme.dev', name: 'Rohan Das', timezone: 'Asia/Kolkata', years: 6, languages: ['English', 'Bengali', 'Hindi'],
    headline: 'Software engineer teaching Python and web development by building',
    bio: 'I build backend systems at a Bengaluru fintech and teach in the evenings. Every course I run is project-first: in week one you write something that works, and we improve it together — tests, clean structure, version control, deployment. I work with school students preparing for CS boards, college students, and professionals switching careers.',
    qualifications: [{ title: 'B.E., Computer Science', institution: 'Jadavpur University', year: 2018 }],
    subjects: [{ slug: 'python-programming', rate: 1300_00, levels: 'Beginner to Intermediate' }, { slug: 'web-development', rate: 1500_00, levels: 'Beginner to Advanced' }],
    durations: [60, 90, 120], buffer: 15, hours: [[1, 20, 23], [2, 20, 23], [4, 20, 23], [6, 9, 17], [7, 9, 13]],
  },
  {
    email: 'priya.nair@teachme.dev', name: 'Priya Nair', timezone: 'Asia/Kolkata', years: 10, languages: ['English', 'Malayalam'],
    headline: 'Biology for curious minds — CBSE, IB and NEET',
    bio: 'Former IB Biology teacher with a decade in the classroom across Kochi and Dubai. I love turning dense textbook chapters into diagrams students can redraw from memory. For NEET aspirants I combine concept sessions with timed MCQ practice and a running error log, so revision targets exactly what you keep getting wrong.',
    qualifications: [{ title: 'M.Sc. Zoology', institution: 'University of Kerala', year: 2012 }, { title: 'IB Biology certification', institution: 'International Baccalaureate', year: 2016 }],
    subjects: [{ slug: 'biology', rate: 1000_00, levels: 'Class 9-12, IB, NEET' }],
    durations: [45, 60], buffer: 10, hours: [[1, 15, 19], [2, 15, 19], [3, 15, 19], [5, 15, 19]],
  },
  {
    email: 'kavya.reddy@teachme.dev', name: 'Kavya Reddy', timezone: 'Asia/Kolkata', years: 7, languages: ['English', 'Telugu', 'Hindi'],
    headline: 'Data scientist teaching statistics and practical machine learning',
    bio: 'I work as a data scientist and hold a master’s in statistics. My sessions use real, messy datasets — cricket scores, air quality readings, e-commerce orders — so the techniques you learn transfer straight to projects and interviews. Comfortable with absolute beginners and with students preparing for analytics roles.',
    qualifications: [{ title: 'M.Stat.', institution: 'Indian Statistical Institute, Kolkata', year: 2017 }],
    subjects: [{ slug: 'data-science', rate: 1800_00, levels: 'Beginner to Intermediate' }, { slug: 'statistics', rate: 1200_00, levels: 'Class 11-12, Undergraduate' }],
    durations: [60, 90], buffer: 15, hours: [[2, 19, 22], [3, 19, 22], [6, 14, 19], [7, 14, 19]],
  },
  {
    email: 'james.whitfield@teachme.dev', name: 'James Whitfield', timezone: 'Europe/London', years: 15, languages: ['English'],
    headline: 'CELTA-qualified English and IELTS tutor, 15 years experience',
    bio: 'I am a British English teacher based in Manchester. I have prepared over a thousand candidates for IELTS, with most of my long-term students improving by at least one band. Sessions are relaxed but focused: we practise under exam conditions, then unpick your answers line by line so you understand exactly what examiners reward.',
    qualifications: [{ title: 'CELTA', institution: 'Cambridge English', year: 2010 }, { title: 'BA English Literature', institution: 'University of Leeds', year: 2008 }],
    subjects: [{ slug: 'ielts', rate: 2000_00, levels: 'Band 5.5 to 8' }, { slug: 'english', rate: 1600_00, levels: 'Intermediate to Advanced' }],
    durations: [45, 60], buffer: 15, hours: [[1, 8, 12], [2, 8, 12], [3, 8, 12], [4, 8, 12], [5, 8, 12]],
  },
  {
    email: 'lucia.fernandez@teachme.dev', name: 'Lucía Fernández', timezone: 'Europe/Madrid', years: 11, languages: ['Spanish', 'English'],
    headline: 'Native Spanish teacher — conversation first, grammar that sticks',
    bio: 'Soy profesora de español from Valencia, certified by Instituto Cervantes. I teach adults and teenagers who want to actually speak, not just pass tests — although my DELE candidates do pass. We will talk about things you care about from the very first class, and I will send a short personalised vocabulary list after each lesson.',
    qualifications: [{ title: 'Acreditación de examinadores DELE', institution: 'Instituto Cervantes', year: 2015 }, { title: 'Grado en Filología Hispánica', institution: 'Universitat de València', year: 2012 }],
    subjects: [{ slug: 'spanish', rate: 1400_00, levels: 'A1 to C1' }],
    durations: [30, 45, 60], buffer: 10, hours: [[1, 9, 13], [3, 9, 13], [5, 9, 13], [2, 16, 20], [4, 16, 20]],
  },
  {
    email: 'nikhil.sharma@teachme.dev', name: 'Nikhil Sharma', timezone: 'Asia/Kolkata', years: 5, languages: ['English', 'Hindi', 'Punjabi'],
    headline: 'Chartered Accountant teaching accountancy and economics',
    bio: 'I qualified as a CA in 2019 and have been teaching Class 11-12 commerce students alongside practice. I connect every accounting entry to a real business scenario, and I bring the same clarity to economics diagrams. Students get a concise formula sheet and past-paper sets matched to their board.',
    qualifications: [{ title: 'Chartered Accountant', institution: 'ICAI', year: 2019 }, { title: 'B.Com (Hons)', institution: 'Shri Ram College of Commerce', year: 2016 }],
    subjects: [{ slug: 'accountancy', rate: 800_00, levels: 'Class 11-12, B.Com' }, { slug: 'economics', rate: 800_00, levels: 'Class 11-12' }],
    durations: [60], buffer: 10, hours: [[1, 18, 21], [2, 18, 21], [3, 18, 21], [4, 18, 21], [5, 18, 21], [7, 11, 15]],
  },
  {
    email: 'ananya.bose@teachme.dev', name: 'Ananya Bose', timezone: 'Asia/Kolkata', years: 14, languages: ['English', 'Bengali', 'Hindi'],
    headline: 'Trinity-certified piano teacher for all ages',
    bio: 'I have taught piano for fourteen years and hold a Trinity College London teaching diploma. Lessons balance technique, reading and pieces you genuinely want to play — from Bach to Bollywood. Online lessons work best with a keyboard or piano and a phone camera positioned to see your hands; I will help you set this up in the first session.',
    qualifications: [{ title: 'ATCL Piano Teaching', institution: 'Trinity College London', year: 2012 }],
    subjects: [{ slug: 'piano', rate: 1000_00, levels: 'Beginner to Grade 8' }],
    durations: [30, 45, 60], buffer: 15, hours: [[2, 16, 20], [4, 16, 20], [6, 10, 17], [7, 10, 17]],
  },
  {
    email: 'vikram.singh@teachme.dev', name: 'Vikram Singh', timezone: 'Asia/Kolkata', years: 9, languages: ['English', 'Hindi'],
    headline: 'Session guitarist teaching rhythm, fingerstyle and songwriting',
    bio: 'I play guitar professionally for studio sessions in Mumbai and have taught for nine years. We start with the songs you love and reverse-engineer the techniques inside them. By the end of a month most beginners can play four or five full songs cleanly and understand why the chords fit together.',
    qualifications: [{ title: 'Diploma in Contemporary Music', institution: 'True School of Music, Mumbai', year: 2015 }],
    subjects: [{ slug: 'guitar', rate: 900_00, levels: 'Beginner to Intermediate' }],
    durations: [30, 60], buffer: 10, hours: [[1, 11, 15], [3, 11, 15], [5, 11, 15], [6, 12, 20]],
  },
  {
    email: 'farah.khan@teachme.dev', name: 'Farah Khan', timezone: 'Asia/Kolkata', years: 6, languages: ['Hindi', 'English', 'Urdu'],
    headline: 'Hindi language and literature — school curricula and heritage learners',
    bio: 'I hold an MA in Hindi literature and teach students from Class 6 to Class 12 as well as NRI children learning Hindi at home. Lessons combine grammar, reading aloud and creative writing, and I adapt texts to each student’s level so progress feels steady rather than overwhelming.',
    qualifications: [{ title: 'M.A. Hindi Literature', institution: 'Banaras Hindu University', year: 2017 }],
    subjects: [{ slug: 'hindi', rate: 700_00, levels: 'Class 6-12, Heritage learners' }],
    durations: [30, 45, 60], buffer: 10, hours: [[1, 16, 20], [2, 16, 20], [4, 16, 20], [7, 9, 12]],
  },
];

/** A teacher who applied but is still awaiting admin review (tests the approval workflow). */
const pendingTeacher = {
  email: 'pending.teacher@teachme.dev', name: 'Rahul Verma', headline: 'Mathematics teacher with 4 years of coaching experience', bio: 'I coach Class 9-10 mathematics students in Pune and want to bring my structured revision method online. Waiting for profile review.',
};

const students = [
  { email: 'aanya.student@teachme.dev', name: 'Aanya Kapoor', grade: 'Class 12 (CBSE)', goals: 'Improve physics problem-solving for boards and JEE Main.' },
  { email: 'dev.student@teachme.dev', name: 'Dev Patel', grade: 'Undergraduate, 2nd year', goals: 'Get comfortable with Python and data analysis for internships.' },
  { email: 'maya.student@teachme.dev', name: 'Maya Thomas', grade: 'Working professional', goals: 'IELTS band 7.5 for a master’s application.' },
];

function slug(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^dr\.\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const now = new Date();

  for (const c of categories) await prisma.subjectCategory.upsert({ where: { slug: c.slug }, create: c, update: { name: c.name, sortOrder: c.sortOrder } });
  const cats = new Map((await prisma.subjectCategory.findMany()).map((c) => [c.slug, c.id]));
  let order = 0;
  for (const s of subjects) {
    const data = { name: s.name, description: s.description, categoryId: cats.get(s.category)!, sortOrder: order++ };
    await prisma.subject.upsert({ where: { slug: s.slug }, create: { slug: s.slug, ...data }, update: data });
  }
  const subj = new Map((await prisma.subject.findMany()).map((s) => [s.slug, s.id]));

  await prisma.user.upsert({
    where: { email: 'admin@teachme.dev' },
    create: { email: 'admin@teachme.dev', passwordHash, fullName: 'Platform Admin', role: 'ADMIN', emailVerifiedAt: now, privacyConsentAt: now },
    update: { role: 'ADMIN', status: 'ACTIVE' },
  });

  for (const t of teachers) {
    const user = await prisma.user.upsert({
      where: { email: t.email },
      create: { email: t.email, passwordHash, fullName: t.name, role: 'TEACHER', timezone: t.timezone, emailVerifiedAt: now, privacyConsentAt: now },
      update: { fullName: t.name, timezone: t.timezone },
    });
    const profileData = {
      headline: t.headline,
      bio: t.bio,
      qualifications: t.qualifications as unknown as Prisma.InputJsonValue,
      yearsExperience: t.years,
      languages: t.languages,
      timezone: t.timezone,
      approvalStatus: 'APPROVED' as const,
      approvedAt: now,
      sessionDurations: t.durations,
      bufferMinutes: t.buffer,
      minNoticeMinutes: 180,
      maxAdvanceDays: 60,
    };
    const profile = await prisma.teacherProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: slug(t.name), ...profileData },
      update: profileData,
    });
    for (const s of t.subjects) {
      await prisma.teacherSubject.upsert({
        where: { teacherId_subjectId: { teacherId: profile.id, subjectId: subj.get(s.slug)! } },
        create: { teacherId: profile.id, subjectId: subj.get(s.slug)!, hourlyRateMinor: s.rate, levels: s.levels },
        update: { hourlyRateMinor: s.rate, levels: s.levels, isActive: true },
      });
    }
    await prisma.teacherAvailability.deleteMany({ where: { teacherId: profile.id } });
    await prisma.teacherAvailability.createMany({
      data: t.hours.map(([dayOfWeek, start, end]) => ({ teacherId: profile.id, dayOfWeek, startMinute: start * 60, endMinute: end * 60 })),
    });
  }

  const pending = await prisma.user.upsert({
    where: { email: pendingTeacher.email },
    create: { email: pendingTeacher.email, passwordHash, fullName: pendingTeacher.name, role: 'TEACHER', emailVerifiedAt: now, privacyConsentAt: now },
    update: {},
  });
  await prisma.teacherProfile.upsert({
    where: { userId: pending.id },
    create: { userId: pending.id, slug: slug(pendingTeacher.name), headline: pendingTeacher.headline, bio: pendingTeacher.bio, languages: ['English', 'Hindi', 'Marathi'], yearsExperience: 4 },
    update: {},
  });

  for (const s of students) {
    await prisma.user.upsert({
      where: { email: s.email },
      create: {
        email: s.email, passwordHash, fullName: s.name, role: 'STUDENT', emailVerifiedAt: now, privacyConsentAt: now,
        studentProfile: { create: { gradeLevel: s.grade, learningGoals: s.goals } },
      },
      update: {},
    });
  }

  const counts = { users: await prisma.user.count(), teachers: await prisma.teacherProfile.count(), subjects: await prisma.subject.count() };
  console.log('Seed complete', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
