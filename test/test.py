from pathlib import Path

from selenium import webdriver
from selenium.webdriver import DesiredCapabilities
from selenium.webdriver.chrome.options import Options

assets_dir = Path(__file__).parent / "test_assets"
assets_dir.mkdir(exist_ok=True)


def get_driver():
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--disable-gpu")
    desired_capabilities = DesiredCapabilities.CHROME
    desired_capabilities["goog:loggingPrefs"] = {"browser": "ALL"}
    driver = webdriver.Chrome(
        options=options, desired_capabilities=desired_capabilities
    )
    driver.implicitly_wait(10)
    return driver


def test_lib():
    driver = get_driver()
    try:
        _tests(driver)
    finally:
        driver.save_screenshot(str(assets_dir / "screenshot.png"))
        (assets_dir / "logs.txt").write_text(
            "\n".join(entry["message"] for entry in driver.get_log("browser"))
        )
        (assets_dir / "page_source.html").write_text(driver.page_source)


def _tests(driver):
    driver.get("http://localhost:8080/")
    div = driver.find_element_by_id("result")
    print(div.text)
    assert "PASSED" in div.text
    assert "FAILED" not in div.text
