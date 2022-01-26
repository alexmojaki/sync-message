import json
import os
from pathlib import Path

from selenium import webdriver
from selenium.webdriver import DesiredCapabilities
from selenium.webdriver.chrome.options import Options

assets_dir = Path(__file__).parent / "test_assets"
assets_dir.mkdir(exist_ok=True)

command_executor = os.environ.get("COMMAND_EXECUTOR")


def get_driver():
    if command_executor:
        desired_capabilities = {
            "browser": "Chrome",
            "os": "Windows",
            "browserstack.local": "true",
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
    driver.implicitly_wait(10)
    return driver


def test_lib():
    driver = get_driver()
    status = "passed"
    try:
        _tests(driver)
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
        driver.save_screenshot(str(assets_dir / "screenshot.png"))
        (assets_dir / "logs.txt").write_text(
            "\n".join(entry["message"] for entry in driver.get_log("browser"))
        )
        (assets_dir / "page_source.html").write_text(driver.page_source)


def _tests(driver):
    driver.get("http://localhost:8080/")
    text = driver.find_element_by_id("result").text
    print(text)
    assert "PASSED" in text
    assert "FAILED" not in text
