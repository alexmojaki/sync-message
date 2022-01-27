import json
import os
from datetime import datetime
from pathlib import Path
from threading import Thread

from selenium import webdriver
from selenium.webdriver import DesiredCapabilities
from selenium.webdriver.chrome.options import Options

assets_dir = Path(__file__).parent / "test_assets"
assets_dir.mkdir(exist_ok=True)

command_executor = os.environ.get("COMMAND_EXECUTOR")
build = str(datetime.now())

def get_driver(caps):
    if command_executor:
        desired_capabilities = {
            **caps,
            "browserstack.local": "true",
            "acceptSslCerts": "true",
            "build": build,
        }
        driver = webdriver.Remote(
            command_executor=command_executor,
            desired_capabilities=desired_capabilities,
        )
    else:
        options = Options()
        options.add_argument("--headless")
        options.add_argument("--disable-gpu")
        desired_capabilities = DesiredCapabilities.CHROME
        desired_capabilities["goog:loggingPrefs"] = {"browser": "ALL"}
        driver = webdriver.Chrome(
            options=options,
            desired_capabilities=desired_capabilities,
        )
    driver.implicitly_wait(30)
    return driver


def params():
    if command_executor:
        for os_name, extra_browser, os_versions in [
            ["Windows", "Edge", ["11"]],
            ["OS X", "Safari", ["Monterey"]],
        ]:
            for browser in ["Chrome", "Firefox", extra_browser]:
                if browser == "Firefox":
                    url = "https://localhost:8001"
                else:
                    url = "http://localhost:8000"
                for os_version in os_versions:
                    yield dict(
                        caps=dict(
                            os=os_name,
                            os_version=os_version,
                            browser=browser,
                        ),
                        url=url,
                    )
    else:
        yield dict(caps=None, url="http://localhost:8080/")


def main():
    for kwargs in params():
        Thread(target=lambda: one_test(**kwargs)).start()


def one_test(caps, url):
    driver = get_driver(caps)
    status = "passed"
    try:
        _tests(driver, url)
    except Exception:
        status = "failed"
    finally:
        if command_executor:
            driver.execute_script(
                "browserstack_executor:"
                + json.dumps(
                    {
                        "action": "setSessionStatus",
                        "arguments": {"status": status},
                    }
                )
            )
            driver.quit()
        else:
            driver.save_screenshot(str(assets_dir / "screenshot.png"))
            (assets_dir / "logs.txt").write_text(
                "\n".join(entry["message"] for entry in driver.get_log("browser"))
            )
            (assets_dir / "page_source.html").write_text(driver.page_source)


def _tests(driver, url):
    driver.get(url)
    text = driver.find_element_by_id("result").text
    print(text)
    assert "PASSED" in text
    assert "FAILED" not in text


main()
