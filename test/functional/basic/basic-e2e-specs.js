import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import B from 'bluebird';
import _ from 'lodash';
import { retryInterval } from 'asyncbox';
import { UICATALOG_CAPS, PLATFORM_VERSION } from '../desired';
import { initSession, deleteSession, MOCHA_TIMEOUT } from '../helpers/session';
import { GUINEA_PIG_PAGE } from '../web/helpers';


chai.should();
chai.use(chaiAsPromised);

describe('XCUITestDriver - basics', function () {
  this.timeout(MOCHA_TIMEOUT);

  let driver;
  before(async () => {
    driver = await initSession(UICATALOG_CAPS);
  });
  after(async () => {
    await deleteSession();
  });

  describe('status', () => {
    it('should get the server status', async () => {
      let status = await driver.status();
      status.wda.should.exist;
    });

    it('should return status immediately if another operation is in progress', async () => {
      await driver.setImplicitWaitTimeout(10000);
      let findElementPromise = B.resolve(driver.elementById('WrongLocator'));
      let status = await driver.status();
      status.wda.should.exist;
      findElementPromise.isPending().should.be.true;
      try {
        await findElementPromise;
      } catch (err) {
        err.status.should.eql(7);
      }
    });
  });

  describe('session', () => {
    it('should get session details with our caps merged with WDA response', async () => {
      let extraWdaCaps = {
        CFBundleIdentifier: "com.example.apple-samplecode.UICatalog",
        browserName: "UICatalog",
        device: "iphone",
        sdkVersion: PLATFORM_VERSION,
      };
      let expected = Object.assign({}, UICATALOG_CAPS, extraWdaCaps);
      let actual = await driver.sessionCapabilities();
      actual.udid.should.exist;
      // don't really know a priori what the udid should be, so just ensure
      // it's there, and validate the rest
      delete actual.udid;
      delete expected.udid; // for real device tests
      // if we are getting metrics for this run (such as on Travis) there will
      // be events in the result, but we cannot know what they should be
      delete actual.events;
      actual.should.eql(expected);
    });
  });

  describe('source', () => {
    it('should get the source for the page', async () => {
      let src = await driver.source();
      (typeof src).should.eql('string');
      src.indexOf('<AppiumAUT>').should.not.eql(-1);
      src.indexOf('<XCUIElementTypeApplication').should.not.eql(-1);
    });
    it('should have full types for elements', async () => {
      let src = await driver.source();
      src.indexOf('<XCUIElementTypeWindow').should.not.eql(-1);
    });
  });

  describe('deactivate app', () => {
    it('should background the app for the specified time', async () => {
      let before = Date.now();
      await driver.backgroundApp(4);
      (Date.now() - before).should.be.above(4000);
      (await driver.source()).indexOf('<AppiumAUT>').should.not.eql(-1);
    });
  });

  describe('screenshot', () => {
    after(async () => {
      try {
        await driver.setOrientation("PORTRAIT");
      } catch (ign) {}
    });
    it('should get an app screenshot', async () => {
      let screenshot = await driver.takeScreenshot();
      screenshot.should.exist;
      screenshot.should.be.a.string;
    });

    it('should get an app screenshot in landscape mode', async () => {
      let screenshot1 = (await driver.takeScreenshot());
      screenshot1.should.exist;

      try {
        await driver.setOrientation("LANDSCAPE");
      } catch (ign) {}
      // take a little pause while it orients, otherwise you get the screenshot
      // on an angle
      await B.delay(500);

      let screenshot2 = await driver.takeScreenshot();
      screenshot2.should.exist;
      screenshot2.should.not.eql(screenshot1);
    });
  });

  describe('logging', () => {
    describe('types', () => {
      it('should get the list of available logs', async () => {
        let expectedTypes = ['syslog', 'crashlog', 'performance'];
        (await driver.logTypes()).should.eql(expectedTypes);
      });
    });

    describe('retrieval', () => {
      it('should throw an error when an invalid type is given', async () => {
        await driver.log('something-random').should.eventually.be.rejected;
      });
      it('should get system logs', async () => {
        (await driver.log('syslog')).should.be.an.Array;
      });
      it('should get crash logs', async () => {
        (await driver.log('crashlog')).should.be.an.Array;
      });
    });
  });

  describe('orientation', () => {
    beforeEach(async () => {
      await driver.setOrientation('PORTRAIT');
    });
    afterEach(async () => {
      await driver.setOrientation('PORTRAIT');
    });
    it('should get the current orientation', async () => {
      let orientation = await driver.getOrientation();
      ['PORTRAIT', 'LANDSCAPE'].should.include(orientation);
    });
    it('should set the orientation', async function () {
      await driver.setOrientation('LANDSCAPE');

      (await driver.getOrientation()).should.eql('LANDSCAPE');
    });
    it('should be able to interact with an element in LANDSCAPE', async function () {
      await driver.setOrientation('LANDSCAPE');

      let el = await driver.elementByAccessibilityId('Buttons');
      await el.click();

      await driver.elementByAccessibilityId('Button').should.not.be.rejected;

      await driver.back();
    });
  });

  describe('window size', () => {
    it('should be able to get the current window size', async () => {
      let size = await driver.getWindowSize('current');
      size.width.should.be.a.number;
      size.height.should.be.a.number;
    });
    it('should not be able to get random window size', async () => {
      await driver.getWindowSize('something-random').should.be.rejectedWith(/Currently only getting current window size is supported/);
    });
  });

  describe('geo location', () => {
    it('should throw a not-yet-implemented error', async () => {
      await driver.setGeoLocation('0', '0', '0').should.be.rejectedWith(/Method has not yet been implemented/);
    });
  });

  describe('shake', () => {
    it('should throw a not-yet-implemented error', async () => {
      await driver.shake().should.be.rejectedWith(/Method has not yet been implemented/);
    });
  });

  describe('lock', () => {
    it('should throw a not-yet-implemented error', async () => {
      await driver.lock().should.be.rejectedWith(/Method has not yet been implemented/);
    });
  });

  describe('contexts', () => {
    before(async function () {
      let el = await driver.elementByAccessibilityId('Web View');
      await driver.execute('mobile: scroll', {element: el, toVisible: true});
      await el.click();
    });
    after(async () => {
      await driver.back();
      await driver.execute('mobile: scroll', {direction: 'up'});
    });

    it('should start a session, navigate to url, get title', async () => {
      let contexts;
      await retryInterval(100, 1000, async () => {
        // on some systems (like Travis) it takes a while to load the webview
        contexts = await driver.contexts();
        contexts.length.should.be.at.least(2);
      });

      let urlBar = await driver.elementByClassName('XCUIElementTypeTextField');
      await urlBar.clear();

      await urlBar.sendKeys(GUINEA_PIG_PAGE);

      let buttons = await driver.elementsByClassName('XCUIElementTypeButton');
      await _.last(buttons).click();

      await driver.context(contexts[1]);

      await retryInterval(100, 1000, async () => {
        let title = await driver.title();
        title.should.equal('I am a page title');
      });

      await driver.context(contexts[0]);
    });
  });
});
