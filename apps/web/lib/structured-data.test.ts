import { describe, expect, it } from 'vitest';
import { FAQS } from './content';
import { SVCS } from './services';
import { SITE_URL } from './site';
import { ORG_ID, breadcrumbLd, faqLd, jsonLdString, servicesLd, siteGraphLd, teacherLd } from './structured-data';

describe('結構化資料（JSON-LD）', () => {
  it('全站：商家＋網站，網址為絕對網址、互相引用同一個 @id', () => {
    const g = siteGraphLd() as { '@graph': Record<string, unknown>[] };
    const [org, site] = g['@graph'];
    expect(org).toMatchObject({ '@type': 'ProfessionalService', '@id': ORG_ID, url: SITE_URL });
    expect(site).toMatchObject({ '@type': 'WebSite', publisher: { '@id': ORG_ID }, inLanguage: 'zh-Hant-TW' });
  });

  it('麵包屑：位置從 1 開始、首頁不帶結尾斜線', () => {
    const b = breadcrumbLd([
      { name: '首頁', path: '/' },
      { name: '諮詢方案', path: '/services' },
    ]) as { itemListElement: Record<string, unknown>[] };
    expect(b.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: '首頁', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: '諮詢方案', item: `${SITE_URL}/services` },
    ]);
  });

  it('方案：每個方案一個新台幣報價', () => {
    const c = servicesLd(SVCS) as { itemListElement: { price: number; priceCurrency: string; itemOffered: { name: string } }[] };
    expect(c.itemListElement).toHaveLength(SVCS.length);
    expect(c.itemListElement[0]).toMatchObject({ price: 2800, priceCurrency: 'TWD', itemOffered: { name: '流年運勢盤' } });
  });

  it('常見問題與老師', () => {
    const f = faqLd(FAQS) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(f.mainEntity).toHaveLength(FAQS.length);
    expect(f.mainEntity[0]!.name).toBe(FAQS[0].q);
    expect(teacherLd('說明')).toMatchObject({ '@type': 'Person', name: '沐妍老師', worksFor: { '@id': ORG_ID } });
  });

  it('輸出時跳脫 <，內容不會提早結束 script 標籤', () => {
    const s = jsonLdString({ text: '</script><script>alert(1)</script>' });
    expect(s).not.toContain('</script>');
    expect(JSON.parse(s)).toEqual({ text: '</script><script>alert(1)</script>' });
  });
});
