import { faker } from '@faker-js/faker';
import {
  fakerDE,
  fakerES,
  fakerFR,
  fakerIT,
  fakerJA,
  fakerKO,
  fakerPT_BR,
  fakerRU,
  fakerZH_CN,
} from '@faker-js/faker';

type FakerLocale = 'en' | 'de' | 'es' | 'fr' | 'it' | 'ja' | 'ko' | 'pt_BR' | 'ru' | 'zh_CN';

const localeMap: Record<FakerLocale, typeof faker> = {
  en: faker,
  de: fakerDE,
  es: fakerES,
  fr: fakerFR,
  it: fakerIT,
  ja: fakerJA,
  ko: fakerKO,
  pt_BR: fakerPT_BR,
  ru: fakerRU,
  zh_CN: fakerZH_CN,
};

export function generateSyntheticData(
  type: string,
  count: number,
  locale: string = 'en'
): Record<string, unknown>[] {
  const fakerInstance = localeMap[locale as FakerLocale] || faker;
  const data: Record<string, unknown>[] = [];

  for (let i = 0; i < count; i++) {
    switch (type) {
      case 'person':
        data.push(generatePerson(fakerInstance));
        break;
      case 'address':
        data.push(generateAddress(fakerInstance));
        break;
      case 'company':
        data.push(generateCompany(fakerInstance));
        break;
      case 'product':
        data.push(generateProduct(fakerInstance));
        break;
      case 'text':
        data.push(generateText(fakerInstance));
        break;
      case 'lorem':
        data.push(generateLorem(fakerInstance));
        break;
      case 'all':
        data.push({
          ...generatePerson(fakerInstance),
          ...generateAddress(fakerInstance),
          ...generateCompany(fakerInstance),
          ...generateProduct(fakerInstance),
          ...generateLorem(fakerInstance),
        });
        break;
      default:
        data.push(generatePerson(fakerInstance));
    }
  }

  return data;
}

function generatePerson(f: typeof faker): Record<string, unknown> {
  return {
    id: f.string.uuid(),
    firstName: f.person.firstName(),
    lastName: f.person.lastName(),
    fullName: f.person.fullName(),
    email: f.internet.email(),
    phone: f.phone.number(),
    username: f.internet.username(),
    password: f.internet.password(),
    avatar: f.image.avatar(),
    jobTitle: f.person.jobTitle(),
    company: f.company.name(),
  };
}

function generateAddress(f: typeof faker): Record<string, unknown> {
  return {
    street: f.location.streetAddress(),
    city: f.location.city(),
    state: f.location.state(),
    country: f.location.country(),
    zipCode: f.location.zipCode(),
    latitude: f.location.latitude(),
    longitude: f.location.longitude(),
  };
}

function generateCompany(f: typeof faker): Record<string, unknown> {
  return {
    companyName: f.company.name(),
    catchPhrase: f.company.catchPhrase(),
    department: f.commerce.department(),
    price: f.commerce.price(),
    product: f.commerce.productName(),
    color: f.color.human(),
  };
}

function generateProduct(f: typeof faker): Record<string, unknown> {
  return {
    id: f.string.uuid(),
    name: f.commerce.productName(),
    description: f.commerce.productDescription(),
    price: parseFloat(f.commerce.price()),
    department: f.commerce.department(),
    color: f.color.human(),
    sku: f.string.alphanumeric(8),
    image: f.image.url({ width: 400, height: 400 }),
  };
}

function generateText(f: typeof faker): Record<string, unknown> {
  return {
    id: f.string.uuid(),
    sentence: f.lorem.sentence(),
    paragraph: f.lorem.paragraph(),
    text: f.lorem.text(),
    slug: f.lorem.slug(),
    words: f.lorem.words(10),
  };
}

function generateLorem(f: typeof faker): Record<string, unknown> {
  return {
    id: f.string.uuid(),
    sentences: f.lorem.sentences(5),
    paragraphs: f.lorem.paragraphs(3),
    lines: f.lorem.lines(5),
    word: f.lorem.word(),
  };
}
