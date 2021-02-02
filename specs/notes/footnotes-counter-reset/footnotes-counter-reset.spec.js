const TIMEOUT = 10000;

describe("footnotes-counter-reset", () => {
	let page;
	beforeAll(async () => {
		page = await loadPage("notes/footnotes/footnotes-counter-reset.html");
		return page.rendered;
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	it("should render 15 pages", async () => {
		let pages = await page.$$eval(".pagedjs_page", (r) => {
			return r.length;
		});

		expect(pages).toEqual(15);
	});


	if (!DEBUG) {
		it("should create a pdf", async () => {
			let pdf = await page.pdf(PDF_SETTINGS);

			expect(pdf).toMatchPDFSnapshot(1);
			expect(pdf).toMatchPDFSnapshot(6);
			expect(pdf).toMatchPDFSnapshot(7);
		});
	}
}
);
